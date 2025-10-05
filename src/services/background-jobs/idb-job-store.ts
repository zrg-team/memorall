import type { BaseJob } from "./handlers/types";

const DB_NAME = "memorall-bg-jobs";
const DB_VERSION = 1;
const STORE = "jobs";

export class IdbJobStore {
	private dbPromise: Promise<IDBDatabase> | null = null;

	private open(): Promise<IDBDatabase> {
		if (this.dbPromise) return this.dbPromise;
		this.dbPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION);

			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(STORE)) {
					const store = db.createObjectStore(STORE, { keyPath: "id" });
					store.createIndex("status", "status", { unique: false });
					store.createIndex("createdAt", "createdAt", { unique: false });
				}
			};

			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		return this.dbPromise;
	}

	async put(job: BaseJob): Promise<void> {
		const db = await this.open();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE, "readwrite");
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			const store = tx.objectStore(STORE);
			store.put(job);
		});
	}

	async get(id: string): Promise<BaseJob | null> {
		const db = await this.open();
		return await new Promise<BaseJob | null>((resolve, reject) => {
			const tx = db.transaction(STORE, "readonly");
			const store = tx.objectStore(STORE);
			const req = store.get(id);
			req.onsuccess = () => resolve((req.result as BaseJob) || null);
			req.onerror = () => reject(req.error);
		});
	}

	async getAll(): Promise<BaseJob[]> {
		const db = await this.open();
		return await new Promise<BaseJob[]>((resolve, reject) => {
			const tx = db.transaction(STORE, "readonly");
			const store = tx.objectStore(STORE);
			const req = store.getAll();
			req.onsuccess = () => resolve((req.result as BaseJob[]) || []);
			req.onerror = () => reject(req.error);
		});
	}

	async delete(id: string): Promise<void> {
		const db = await this.open();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE, "readwrite");
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			const store = tx.objectStore(STORE);
			store.delete(id);
		});
	}

	async clearCompleted(): Promise<void> {
		const jobs = await this.getAll();
		const toDelete = jobs.filter(
			(j) => j.status === "completed" || j.status === "failed",
		);
		if (toDelete.length === 0) return;
		const db = await this.open();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE, "readwrite");
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			const store = tx.objectStore(STORE);
			toDelete.forEach((j) => store.delete(j.id));
		});
	}
}
