// Minimal ISO-9660 writer for cloud-init's NoCloud datasource. No host tools,
// shell, Python, genisoimage, or writable shared directory are required.
const SECTOR = 2048;
export function createSeedIso(files: Record<string, string>): Buffer {
	const entries = Object.entries(files).map(([name, content]) => ({
		name: name.toUpperCase(),
		content: Buffer.from(content),
		sector: 0,
	}));
	let next = 22;
	for (const entry of entries) {
		entry.sector = next;
		next += Math.ceil(entry.content.length / SECTOR);
	}
	const image = Buffer.alloc(next * SECTOR);
	const both16 = (b: Buffer, offset: number, value: number) => {
		b.writeUInt16LE(value, offset);
		b.writeUInt16BE(value, offset + 2);
	};
	const both32 = (b: Buffer, offset: number, value: number) => {
		b.writeUInt32LE(value, offset);
		b.writeUInt32BE(value, offset + 4);
	};
	const record = (
		sector: number,
		size: number,
		name: Buffer,
		directory = false,
	) => {
		const b = Buffer.alloc(33 + name.length + (name.length % 2 === 0 ? 1 : 0));
		b[0] = b.length;
		both32(b, 2, sector);
		both32(b, 10, size);
		Buffer.from([126, 1, 1, 0, 0, 0, 0]).copy(b, 18);
		b[25] = directory ? 2 : 0;
		both16(b, 28, 1);
		b[32] = name.length;
		name.copy(b, 33);
		return b;
	};
	const pvd = image.subarray(16 * SECTOR, 17 * SECTOR);
	pvd[0] = 1;
	pvd.write("CD001", 1);
	pvd[6] = 1;
	pvd.fill(32, 8, 72);
	pvd.write("MEMORALL", 8);
	pvd.write("cidata", 40);
	both32(pvd, 80, next);
	both16(pvd, 120, 1);
	both16(pvd, 124, 1);
	both16(pvd, 128, SECTOR);
	both32(pvd, 132, 10);
	pvd.writeUInt32LE(19, 140);
	pvd.writeUInt32BE(20, 148);
	record(21, SECTOR, Buffer.from([0]), true).copy(pvd, 156);
	pvd[881] = 1;
	const end = image.subarray(17 * SECTOR);
	end[0] = 255;
	end.write("CD001", 1);
	end[6] = 1;
	for (const [sector, big] of [
		[19, false],
		[20, true],
	] as const) {
		const b = image.subarray(sector * SECTOR);
		b[0] = 1;
		if (big) {
			b.writeUInt32BE(21, 2);
			b.writeUInt16BE(1, 6);
		} else {
			b.writeUInt32LE(21, 2);
			b.writeUInt16LE(1, 6);
		}
	}
	let offset = 21 * SECTOR;
	for (const r of [
		record(21, SECTOR, Buffer.from([0]), true),
		record(21, SECTOR, Buffer.from([1]), true),
		...entries.map((e) =>
			record(e.sector, e.content.length, Buffer.from(e.name)),
		),
	]) {
		if (offset + r.length > 22 * SECTOR)
			throw new Error("Seed directory is too large");
		r.copy(image, offset);
		offset += r.length;
	}
	for (const entry of entries) entry.content.copy(image, entry.sector * SECTOR);
	return image;
}

export function seedFiles(
	guestSource: string,
	instanceId: string,
): Record<string, string> {
	const encoded = Buffer.from(guestSource).toString("base64");
	return {
		"meta-data": JSON.stringify({
			"instance-id": instanceId,
			"local-hostname": "memorall",
		}),
		// NoCloud otherwise generates a fallback DHCP interface and can wait
		// two minutes for network-online, despite this VM having no NIC.
		"network-config": JSON.stringify({ version: 2, ethernets: {} }),
		"user-data": `#cloud-config
users:
  - name: memorall
    uid: 1000
    shell: /bin/bash
    lock_passwd: true
ssh_pwauth: false
ssh_genkeytypes: []
ssh_publish_hostkeys:
  enabled: false
disable_root: true
manage_etc_hosts: true
write_files:
  - path: /opt/memorall/guest.py
    permissions: '0700'
    encoding: b64
    content: ${encoded}
  - path: /etc/systemd/system/memorall-guest.service
    permissions: '0644'
    content: |
      [Unit]
      After=cloud-final.service
      [Service]
      ExecStart=/usr/bin/python3 /opt/memorall/guest.py
      Restart=always
      RestartSec=1
      [Install]
      WantedBy=cloud-init.target
runcmd:
  - [systemctl, disable, memorall-guest.service]
  - [systemctl, enable, memorall-guest.service]
  - [systemctl, restart, --no-block, memorall-guest.service]
`,
	};
}
