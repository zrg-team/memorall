import { toFlowFileSystem } from "@/services/flow-service-adapters";
import { documentFileSystemService } from "@/services/filesystem/document-filesystem";
import { zipFolder } from "@/services/filesystem/folder-zip";

/** Hands bytes to the browser as a download named `name`. */
export const saveBytesAsDownload = (
	bytes: Uint8Array,
	name: string,
	type = "application/octet-stream",
): void => {
	const url = URL.createObjectURL(new Blob([bytes.slice()], { type }));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	// After the click has handed the URL to the download.
	setTimeout(() => URL.revokeObjectURL(url), 1_000);
};

/** Zips a folder of Files and downloads it as `<folder>.zip`. */
export const downloadFolderAsZip = async (folderPath: string) => {
	const zip = await zipFolder(
		toFlowFileSystem(documentFileSystemService),
		folderPath,
	);
	saveBytesAsDownload(zip.bytes, zip.name, "application/zip");
	return zip;
};
