#!/usr/bin/env python3
"""Memorall's guest-only execution service. Never import this in a host app.

The virtio control channel is private to the VM supervisor. All filesystem
paths crossing that channel are contained under /workspace; processes run as
the unprivileged memorall user. Guest root is still untrusted by the host.
"""
import base64
import concurrent.futures
import hashlib
import http.client
import json
import os
import pathlib
import pwd
import select
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import tarfile
import threading
import time
import urllib.request
import urllib.error
import uuid

ROOT = pathlib.Path(os.environ.get("MEMORALL_GUEST_WORKSPACE", "/workspace"))
STATE = pathlib.Path(os.environ.get("MEMORALL_GUEST_STATE", "/var/lib/memorall"))
EXCLUDED = {"node_modules", ".git", ".venv", "__pycache__", ".next", ".cache", "target"}
MAX_FILE = 16 * 1024 * 1024
PROXY = "http://127.0.0.1:3128"
PROCESSES = {}
SERVERS = {}
CHANNELS = {}
EGRESS = {}
BASELINE = {}
STUBS = {}
IN_FLIGHT = None
VFS_ID = str(uuid.uuid4())
SOURCE_HASH = hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()
LOCK = threading.RLock()
SEND_LOCK = threading.Lock()
SEND = lambda value: None
REQUEST_CONTEXT = threading.local()
CANCELLED_REQUESTS = set()
LOGS = []
RESERVED_PORTS = {3128}


def preview_port(port):
    if not isinstance(port, int) or port < 1024 or port > 65535 or port in RESERVED_PORTS:
        raise ValueError("Preview port must be between 1024 and 65535 and not reserved")
    return port


def pack(value):
    if isinstance(value, bytes):
        return {"$bytes": base64.b64encode(value).decode()}
    if isinstance(value, dict):
        return {k: pack(v) for k, v in value.items()}
    if isinstance(value, list):
        return [pack(v) for v in value]
    return value


def unpack(value):
    if isinstance(value, dict):
        if set(value) == {"$bytes"}:
            return base64.b64decode(value["$bytes"], validate=True)
        return {k: unpack(v) for k, v in value.items()}
    if isinstance(value, list):
        return [unpack(v) for v in value]
    return value


def path(value="/"):
    if not isinstance(value, str) or "\x00" in value or "\\" in value:
        raise ValueError("Invalid workspace path")
    relative = pathlib.PurePosixPath(value.lstrip("/"))
    if ".." in relative.parts:
        raise ValueError("Path leaves workspace")
    target = ROOT.joinpath(*relative.parts)
    if not target.resolve().is_relative_to(ROOT.resolve()):
        raise ValueError("Symlink leaves workspace")
    return target


def own(target):
    if os.geteuid() == 0:
        user = pwd.getpwnam("memorall")
        os.chown(target, user.pw_uid, user.pw_gid)


def ensure_dir(target):
    missing = []
    cursor = target
    while not cursor.exists():
        missing.append(cursor)
        cursor = cursor.parent
    target.mkdir(parents=True, exist_ok=True)
    for item in reversed(missing):
        own(item)


def alias(value):
    # Public logical roots, e.g. /agents/alice, retain their absolute paths.
    # System roots are never replaced, and no host disk is mounted here.
    parts = pathlib.PurePosixPath(value).parts
    if len(parts) < 2 or parts[1] in {"bin", "etc", "dev", "proc", "sys", "usr", "var", "opt", "run", "tmp", "home", "root", "lib", "lib64", "sbin", "workspace"}:
        return
    link = pathlib.Path("/") / parts[1]
    if not os.path.lexists(link):
        link.symlink_to(ROOT / parts[1])


def scan():
    result = {}
    for directory, dirs, files in os.walk(ROOT, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d not in EXCLUDED and not pathlib.Path(directory, d).is_symlink())
        if pathlib.Path(directory) != ROOT:
            result["/" + pathlib.Path(directory).relative_to(ROOT).as_posix()] = (0, -1)
        for name in files:
            item = pathlib.Path(directory, name)
            if item.is_symlink() or not item.is_file():
                continue
            stat = item.stat()
            logical = "/" + item.relative_to(ROOT).as_posix()
            result[logical] = (stat.st_mtime_ns, stat.st_size)
    return result


def apply_sync(payload):
    if payload["vfsId"] != VFS_ID:
        return {"stale": True, "changed": [], "skipped": [], "missing": []}
    data = payload.get("buffer", b"")
    changed = []
    with LOCK:
        for op in payload["ops"]:
            name = op.get("path", op.get("from"))
            target = path(name)
            if op["op"] == "stub":
                STUBS[name] = op["size"]
                continue
            if op["op"] == "write":
                offset, length = op["offset"], op["length"]
                if offset < 0 or length < 0 or offset + length > len(data):
                    raise ValueError("Invalid file buffer range")
                ensure_dir(target.parent)
                target.write_bytes(data[offset:offset + length])
                own(target)
                STUBS.pop(name, None)
            elif op["op"] == "mkdir":
                ensure_dir(target)
            elif op["op"] == "delete":
                if target == ROOT:
                    raise ValueError("Cannot delete workspace root")
                if target.is_dir():
                    shutil.rmtree(target)
                elif target.exists():
                    target.unlink()
                for entry in list(BASELINE):
                    if entry == name or entry.startswith(name.rstrip("/") + "/"):
                        BASELINE.pop(entry, None)
            elif op["op"] == "rename":
                other = path(op["to"])
                if target == ROOT or other == ROOT:
                    raise ValueError("Cannot rename workspace root")
                ensure_dir(other.parent)
                if target.exists():
                    target.rename(other)
                for entry in list(BASELINE):
                    if entry == name or entry.startswith(name.rstrip("/") + "/"):
                        BASELINE[op["to"] + entry[len(name):]] = BASELINE.pop(entry)
                alias(op["to"])
            else:
                raise ValueError("Unsupported sync operation")
            alias(name)
            changed.append(name)
            if target.is_file():
                stat = target.stat()
                BASELINE[name] = (stat.st_mtime_ns, stat.st_size)
            elif target.is_dir():
                BASELINE[name] = (0, -1)
        return {"changed": changed, "skipped": [], "missing": []}


def collect():
    global IN_FLIGHT
    with LOCK:
        if IN_FLIGHT:
            return IN_FLIGHT[0]
        current, ops, contents, versions, size = scan(), [], [], {}, 0
        for name, version in current.items():
            if len(ops) >= 1000:
                break
            if BASELINE.get(name) == version:
                continue
            if version[1] == -1:
                ops.append({"op": "mkdir", "path": name})
                versions[name] = version
                continue
            if version[1] > MAX_FILE:
                # Large build/media outputs stay in the guest. One such file
                # must not prevent every other workspace change from saving.
                continue
            if size and size + version[1] > 8 * 1024 * 1024:
                break
            with path(name).open("rb") as source:
                content = source.read(MAX_FILE + 1)
            if len(content) > MAX_FILE:
                continue
            ops.append({"op": "write", "path": name, "offset": size, "length": len(content)})
            contents.append(content)
            size += len(content)
            versions[name] = version
        for name in sorted(BASELINE.keys() - current.keys(), key=lambda item: -item.count("/")):
            if len(ops) >= 1000:
                break
            if name not in STUBS:
                ops.append({"op": "delete", "path": name, "dir": BASELINE[name][1] == -1})
                versions[name] = None
        result = {"vfsId": VFS_ID, "batchId": int(time.time_ns() // 1000000), "ops": ops, "buffer": b"".join(contents)}
        if not ops:
            result["batchId"] = None
        else:
            IN_FLIGHT = (result, versions)
        return result


def ack(payload):
    global IN_FLIGHT
    with LOCK:
        if not IN_FLIGHT or payload["batchId"] != IN_FLIGHT[0]["batchId"]:
            return {"acknowledged": False}
        failed = {f["index"] for f in payload["failures"]}
        for index, op in enumerate(IN_FLIGHT[0]["ops"]):
            if index in failed:
                continue
            name = op["path"]
            version = IN_FLIGHT[1][name]
            if version is None:
                BASELINE.pop(name, None)
            else:
                BASELINE[name] = version
        IN_FLIGHT = None
        return {"acknowledged": True}


def command_result(record, offset=0, wait_ms=0):
    deadline = time.monotonic() + min(max(wait_ms, 0), 30000) / 1000
    with record["condition"]:
        while record["next"] <= offset and not record["finished"] and time.monotonic() < deadline:
            record["condition"].wait(max(0, deadline - time.monotonic()))
        first = max(0, offset - record["base"])
        chunks = record["chunks"][first:]
        # The child can exit before its PTY reader drains the last bytes.
        # Completion must not make the renderer stop polling too early.
        code = record["child"].poll() if record["finished"] else None
        status = "running" if code is None else "stopped" if code < 0 else "completed" if code == 0 else "failed"
        return {"commandId": record["id"], "command": record["command"], "cwd": record["cwd"],
                "status": status, "completed": code is not None, "exitCode": code,
                "stdout": "".join(c["stdout"] for c in chunks), "stderr": "".join(c["stderr"] for c in chunks),
                "chunks": chunks, "nextOffset": record["next"], "startedAt": record["started"], "updatedAt": int(time.time() * 1000)}


def start_command(payload):
    import pty
    import codecs
    cwd = payload.get("cwd") or "/"
    directory = path(cwd)
    ensure_dir(directory)
    alias(cwd)
    user = pwd.getpwnam("memorall")
    env = {"PATH": "/opt/memorall/bin:/usr/local/bin:/usr/bin:/bin", "HOME": user.pw_dir,
           "NODE_OPTIONS": "--use-env-proxy",
           "LANG": "C.UTF-8", "TERM": "xterm-256color", "http_proxy": PROXY, "https_proxy": PROXY,
           "HTTP_PROXY": PROXY, "HTTPS_PROXY": PROXY, "NO_PROXY": "localhost,127.0.0.1,::1"}
    environment = payload.get("env")
    if environment is None:
        environment = {}
    if not isinstance(environment, dict):
        raise ValueError("Environment must be a map of string values")
    for key, value in environment.items():
        if key in {"PATH", "HOME", "BASH_ENV", "LD_PRELOAD", "LD_LIBRARY_PATH"} or not isinstance(value, str):
            raise ValueError("Environment key is reserved: " + key)
        env[key] = value
    master, slave = pty.openpty()
    request_id = getattr(REQUEST_CONTEXT, "id", None)
    with LOCK:
        if request_id in CANCELLED_REQUESTS:
            os.close(master)
            os.close(slave)
            raise ValueError("Sandbox request cancelled")
        child = subprocess.Popen(["/bin/bash", "-c", payload["command"]], cwd=directory, env=env,
                                 stdin=slave, stdout=slave, stderr=slave, start_new_session=True,
                                 user=user.pw_uid, group=user.pw_gid, extra_groups=[], close_fds=True)
    os.close(slave)
    record = {"id": str(uuid.uuid4()), "child": child, "fd": master, "cwd": cwd, "command": payload["command"],
              "chunks": [], "base": 0, "next": 0, "finished": False, "started": int(time.time() * 1000), "condition": threading.Condition(), "requestId": request_id}
    with LOCK:
        PROCESSES[record["id"]] = record
        if request_id in CANCELLED_REQUESTS:
            stop(record)
        # Retain output for recent completed commands without growing forever.
        for key, previous in list(PROCESSES.items())[:-200]:
            if previous["finished"]:
                PROCESSES.pop(key, None)
    def read():
        decoder = codecs.getincrementaldecoder("utf-8")("replace")
        try:
            while True:
                data = os.read(master, 4096)
                if not data:
                    break
                with record["condition"]:
                    record["chunks"].append({"stdout": decoder.decode(data), "stderr": ""})
                    record["next"] += 1
                    if len(record["chunks"]) > 256:
                        record["chunks"].pop(0)
                        record["base"] += 1
                    record["condition"].notify_all()
        except OSError:
            pass
        finally:
            child.wait()
            os.close(master)
            with record["condition"]:
                tail = decoder.decode(b"", final=True)
                if tail:
                    record["chunks"].append({"stdout": tail, "stderr": ""})
                    record["next"] += 1
                record["finished"] = True
                record["condition"].notify_all()
    threading.Thread(target=read, daemon=True).start()
    timeout = payload.get("commandTimeoutMs", 600000)
    if timeout:
        def expire():
            with record["condition"]:
                finished = record["condition"].wait_for(lambda: record["finished"], min(timeout, 3600000) / 1000)
            if not finished:
                stop(record)
        threading.Thread(target=expire, daemon=True).start()
    return command_result(record, 0, payload.get("waitTimeoutMs", 0))


def stop(record):
    if not record["finished"]:
        try:
            os.killpg(record["child"].pid, signal.SIGTERM)
            with record["condition"]:
                finished = record["condition"].wait_for(lambda: record["finished"], 2)
            if not finished:
                os.killpg(record["child"].pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def stop_port(port):
    inodes = set()
    for filename in ("/proc/net/tcp", "/proc/net/tcp6"):
        for line in pathlib.Path(filename).read_text().splitlines()[1:]:
            fields = line.split()
            if fields[3] == "0A" and int(fields[1].split(":")[1], 16) == port:
                inodes.add("socket:[" + fields[9] + "]")
    uid = pwd.getpwnam("memorall").pw_uid
    for entry in pathlib.Path("/proc").iterdir():
        try:
            if entry.name.isdigit() and entry.stat().st_uid == uid and any(os.readlink(fd) in inodes for fd in (entry / "fd").iterdir()):
                os.kill(int(entry.name), signal.SIGTERM)
        except (OSError, ProcessLookupError):
            pass


def setup_tools():
    """Wrappers install only an explicitly invoked tool, entirely in the guest."""
    installer = r'''#!/usr/bin/python3
import fcntl, hashlib, os, pathlib, shutil, subprocess, sys, tarfile, urllib.request
tool = sys.argv[1] if len(sys.argv) == 2 else ''
packages = {'git': ['git'], 'ffmpeg': ['ffmpeg'], 'magick': ['imagemagick'], 'python': ['python3-venv', 'python3-pip'], 'build': ['build-essential']}
if tool not in packages and tool != 'node': raise SystemExit('Unknown managed tool')
os.environ.update(http_proxy='http://127.0.0.1:3128', https_proxy='http://127.0.0.1:3128', DEBIAN_FRONTEND='noninteractive')
with open('/run/memorall-tools.lock', 'w') as lock:
 fcntl.flock(lock, fcntl.LOCK_EX)
 marker = pathlib.Path('/var/lib/memorall/tools/' + tool)
 if marker.exists(): raise SystemExit(0)
 print('Installing ' + tool + ' in the sandbox. This requires internet on first use.', flush=True)
 if tool == 'node':
  arch = 'arm64' if os.uname().machine == 'aarch64' else 'x64'
  name = 'node-v22.23.1-linux-' + arch
  url = 'https://nodejs.org/dist/v22.23.1/'
  sums = urllib.request.urlopen(url + 'SHASUMS256.txt', timeout=60).read().decode()
  expected = next(line.split()[0] for line in sums.splitlines() if line.split()[-1] == name + '.tar.xz')
  target = pathlib.Path('/opt/memorall/tools'); target.mkdir(parents=True, exist_ok=True)
  archive = target / 'node.tar.xz'
  with urllib.request.urlopen(url + name + '.tar.xz', timeout=120) as source, archive.open('wb') as dest: shutil.copyfileobj(source, dest)
  if hashlib.sha256(archive.read_bytes()).hexdigest() != expected: archive.unlink(); raise SystemExit('Node checksum mismatch')
  for stale in [target / name, target / 'node']:
   if stale.exists(): shutil.rmtree(stale)
  with tarfile.open(archive) as tar: tar.extractall(target, filter='data')
  (target / name).rename(target / 'node'); archive.unlink()
 else:
  subprocess.run(['apt-get', 'update', '-qq'], check=True)
  subprocess.run(['apt-get', 'install', '-y', '--no-install-recommends'] + packages[tool], check=True)
  subprocess.run(['apt-get', 'clean'], check=True)
  if tool == 'python':
   subprocess.run(['runuser', '-u', 'memorall', '--', 'python3', '-m', 'venv', '/home/memorall/.venv'], check=True)
 marker.parent.mkdir(parents=True, exist_ok=True); marker.touch()
'''
    target = pathlib.Path("/opt/memorall/install-tool")
    target.write_text(installer)
    target.chmod(0o755)
    pathlib.Path("/etc/sudoers.d/memorall-tools").write_text("memorall ALL=(root) NOPASSWD: /opt/memorall/install-tool *\n")
    pathlib.Path("/etc/sudoers.d/memorall-tools").chmod(0o440)
    wrappers = {"node": ("node", "/opt/memorall/tools/node/bin/node"), "npm": ("node", "/opt/memorall/tools/node/bin/npm"), "npx": ("node", "/opt/memorall/tools/node/bin/npx"),
                "git": ("git", "/usr/bin/git"), "ffmpeg": ("ffmpeg", "/usr/bin/ffmpeg"), "ffprobe": ("ffmpeg", "/usr/bin/ffprobe"),
                "magick": ("magick", "/usr/bin/convert"), "convert": ("magick", "/usr/bin/convert"), "identify": ("magick", "/usr/bin/identify"),
                "pip": ("python", "/home/memorall/.venv/bin/pip"), "pip3": ("python", "/home/memorall/.venv/bin/pip"),
                "python": ("python", "/home/memorall/.venv/bin/python"), "gcc": ("build", "/usr/bin/gcc"), "make": ("build", "/usr/bin/make")}
    directory = pathlib.Path("/opt/memorall/bin")
    directory.mkdir(parents=True, exist_ok=True)
    for name, (tool, command) in wrappers.items():
        wrapper = directory / name
        wrapper.write_text('#!/bin/sh\nif [ ! -f /var/lib/memorall/tools/' + tool + ' ]; then\n  sudo -n /opt/memorall/install-tool ' + tool + ' || exit $?\nfi\nexec ' + command + ' "$@"\n')
        wrapper.chmod(0o755)
    py = directory / "py"
    py.write_text('#!/bin/sh\nexec /usr/bin/python3 "$@"\n')
    py.chmod(0o755)


def network_fetch(payload):
    url = payload["url"]
    if not url.startswith(("http://", "https://")):
        raise ValueError("Only HTTP(S) URLs are supported")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}))
    request = urllib.request.Request(url, data=payload.get("body", "").encode() if "body" in payload else None,
                                     headers=payload.get("headers", {}), method=payload.get("method", "GET"))
    try:
        response = opener.open(request, timeout=min(payload.get("timeoutMs", 30000), 120000) / 1000)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        content = response.read(1024 * 1024 + 1)
        if len(content) > 1024 * 1024:
            raise ValueError("Network response exceeds 1 MiB")
        content_type = response.headers.get("Content-Type", "text/plain")
        return {"url": response.url, "status": response.status, "ok": response.status < 400, "contentType": content_type,
                "responseType": "json" if "json" in content_type else "html" if "html" in content_type else "text", "body": content.decode("utf-8", "replace")}


def start_server(payload):
    port = preview_port(payload["port"])
    if port in SERVERS and PROCESSES[SERVERS[port]["commandId"]]["child"].poll() is None:
        return SERVERS[port]
    kind = payload.get("kind") or "express"
    cwd = payload.get("rootDir") or "/"
    directory = path(cwd)
    ensure_dir(directory)
    created = []
    template = payload.get("template")
    if template:
        if template == "express":
            scaffold = {"package.json": json.dumps({"private": True, "scripts": {"start": "node server.cjs"}}),
                        "server.cjs": "require('http').createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body><h1>Memorall sandbox</h1></body></html>')}).listen(" + str(port) + ", '0.0.0.0');\n"}
        elif template == "vite-react":
            scaffold = {"package.json": json.dumps({"private": True, "type": "module", "scripts": {"dev": "vite"}, "dependencies": {"vite": "^7.0.0", "react": "^19.0.0", "react-dom": "^19.0.0"}}),
                        "index.html": '<!doctype html><html><body><div id="root"></div><script type="module" src="/src.jsx"></script></body></html>',
                        "src.jsx": "import React from 'react'; import {createRoot} from 'react-dom/client'; createRoot(document.getElementById('root')).render(<h1>Memorall sandbox</h1>);"}
        elif template in {"next-app", "next-pages"}:
            scaffold = {"package.json": json.dumps({"private": True, "scripts": {"dev": "next dev"}, "dependencies": {"next": "^16.0.0", "react": "^19.0.0", "react-dom": "^19.0.0"}})}
            if template == "next-app":
                scaffold.update({"app/layout.jsx": "export default function Layout({children}) {return <html><body>{children}</body></html>}", "app/page.jsx": "export default function Page(){return <h1>Memorall sandbox</h1>}"})
            else:
                scaffold["pages/index.jsx"] = "export default function Page(){return <h1>Memorall sandbox</h1>}"
        else:
            raise ValueError("Unknown preview template")
        for name, content in scaffold.items():
            destination = path(cwd.rstrip("/") + "/" + name)
            if destination.exists():
                continue
            ensure_dir(destination.parent)
            destination.write_text(content)
            own(destination)
            created.append(cwd.rstrip("/") + "/" + name)
    command = ""
    if template and payload.get("autoInstall", True) and template != "express":
        command = "npm install && "
    if kind == "vite" or template == "vite-react":
        command += "./node_modules/.bin/vite --host 0.0.0.0 --port " + str(port)
    elif kind == "next" or template in {"next-app", "next-pages"}:
        command += "./node_modules/.bin/next dev --hostname 0.0.0.0 --port " + str(port)
    else:
        entry = payload.get("entryPath") or cwd.rstrip("/") + ("/server.cjs" if template else "/server.js")
        command += "node " + shlex.quote(str(path(entry)))
    result = start_command({"command": command, "cwd": cwd, "commandTimeoutMs": 0, "env": {"PORT": str(port)}})
    deadline = time.monotonic() + 600
    while time.monotonic() < deadline:
        record = PROCESSES[result["commandId"]]
        if record["child"].poll() is not None:
            raise ValueError("Server failed: " + command_result(record)["stdout"][-4000:])
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                break
        except OSError:
            time.sleep(0.2)
    else:
        stop(record)
        raise ValueError("Server did not start within ten minutes")
    info = {"port": port, "kind": kind, "rootDir": cwd, "createdFiles": created, "commandId": result["commandId"],
            "url": "http://localhost:" + str(port), "renderUrl": "http://localhost:" + str(port)}
    SERVERS[port] = info
    return info


def server_request(payload, binary=False):
    port = preview_port(payload["port"])
    target = payload.get("path", "/")
    if not target.startswith("/") or target.startswith("//"):
        raise ValueError("Server requests require a relative path")
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=min(payload.get("timeoutMs", 30000), 120000) / 1000)
    try:
        connection.request(payload.get("method", "GET"), target, payload.get("body"), payload.get("headers", {}))
        response = connection.getresponse()
        content = response.read(MAX_FILE + 1)
        if len(content) > MAX_FILE:
            raise ValueError("Preview response exceeds transfer limit")
        headers = dict(response.getheaders())
        if binary:
            return {"statusCode": response.status, "statusMessage": response.reason, "headers": headers, "bodyBase64": base64.b64encode(content).decode()}
        content_type = headers.get("Content-Type", "text/plain")
        return {"port": port, "url": "http://localhost:" + str(port) + target, "status": response.status, "ok": response.status < 400,
                "headers": headers, "contentType": content_type, "responseType": "json" if "json" in content_type else "html" if "html" in content_type else "text", "body": content.decode("utf-8", "replace")}
    finally:
        connection.close()


def dispatch(operation, payload):
    global IN_FLIGHT
    payload = payload or {}
    if operation == "health":
        return {"ready": True, "initializedAt": int(time.time() * 1000), "protocol": 1, "sourceHash": SOURCE_HASH,
                "instanceId": VFS_ID, "provisioned": pathlib.Path("/var/lib/cloud/instance/boot-finished").exists()}
    if operation.startswith("egress."):
        entry = EGRESS.get(payload["channel"])
        if not entry:
            return {}
        connection, ready = entry
        if operation == "egress.ready":
            ready.set()
        elif operation == "egress.data":
            connection.sendall(base64.b64decode(payload["data"], validate=True))
        elif operation == "egress.close":
            EGRESS.pop(payload["channel"], None)
            ready.set()
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            connection.close()
        return {}
    if operation == "runtime.cancel":
        with LOCK:
            CANCELLED_REQUESTS.add(payload["requestId"])
            if len(CANCELLED_REQUESTS) > 1024:
                CANCELLED_REQUESTS.remove(min(CANCELLED_REQUESTS))
            for record in list(PROCESSES.values()):
                if record.get("requestId") == payload["requestId"]:
                    stop(record)
        return {"cancelled": True}
    if operation == "runtime.shutdown":
        for record in list(PROCESSES.values()):
            stop(record)
        os.sync()
        subprocess.Popen(["/sbin/poweroff"])
        return {"stopping": True}
    if operation == "sync.state":
        return {"vfsId": VFS_ID, "dirty": 0, "inFlight": 0, "stubs": len(STUBS)}
    if operation == "sync.apply":
        return apply_sync(payload)
    if operation == "sync.collect":
        return collect()
    if operation == "sync.ack":
        return ack(payload)
    if operation == "sync.stubs":
        return {"stubs": [{"path": k, "size": v} for k, v in STUBS.items() if k.startswith(payload.get("root", "/"))]}
    if operation == "sync.packLocal":
        return {"root": payload["root"], "exists": False}
    if operation == "sync.restoreLocal":
        return {"root": payload["root"], "restored": False}
    if operation == "runtime.executeCommand":
        return start_command(payload)
    if operation == "runtime.listCommands":
        return {"commands": [dict(command_result(r, r["next"]), outputTail="".join(c["stdout"] for c in r["chunks"])[-4000:]) for r in PROCESSES.values()]}
    if operation in {"runtime.listenCommand", "runtime.stopCommand", "runtime.sendCommandInput"}:
        record = PROCESSES.get(payload["commandId"])
        if not record:
            raise ValueError("Command not found")
        if operation == "runtime.listenCommand":
            return command_result(record, payload.get("offset", 0), payload.get("waitTimeoutMs", 0))
        if operation == "runtime.stopCommand":
            stop(record)
            return {"commandId": record["id"], "stopped": True}
        os.write(record["fd"], (payload["input"] + ("\n" if payload.get("appendNewline") else "")).encode())
        return {"commandId": record["id"], "sent": True}
    if operation in {"runtime.executeCode", "runtime.runFile"}:
        command = "node -e " + shlex.quote(payload["code"]) if "code" in payload else "node " + shlex.quote(str(path(payload["path"])))
        started = time.monotonic()
        result = start_command({"command": command, "commandTimeoutMs": payload.get("timeoutMs", 30000)})
        record = PROCESSES[result["commandId"]]
        while record["child"].poll() is None:
            time.sleep(0.05)
        result = command_result(record)
        lines = [{"level": "log" if result["exitCode"] == 0 else "error", "message": line, "timestamp": result["updatedAt"]} for line in result["stdout"].splitlines()]
        limit = max(0, min(payload.get("maxLogEntries", 500), 500))
        LOGS.extend(lines)
        del LOGS[:-500]
        return {"status": "ok" if result["exitCode"] == 0 else "timeout" if result["exitCode"] < 0 else "error", "durationMs": int((time.monotonic() - started) * 1000),
                "result": result["stdout"], "error": result["stdout"] if result["exitCode"] else "", "logs": lines[:limit], "truncatedLogs": max(0, len(lines) - limit), "path": payload.get("path")}
    if operation == "runtime.getLogs":
        return {"logs": LOGS[-max(1, min(payload.get("limit", 500), 500)):]}
    if operation == "runtime.clearLogs":
        LOGS.clear()
        return {"cleared": True}
    if operation == "runtime.reset":
        for record in PROCESSES.values():
            stop(record)
        PROCESSES.clear()
        return {"reset": True}
    if operation.startswith("fs."):
        target = path(payload.get("path", payload.get("oldPath", "/")))
        if operation == "fs.exists":
            return {"path": payload["path"], "exists": target.exists()}
        if operation == "fs.readFile":
            if target.stat().st_size > MAX_FILE:
                raise ValueError("File exceeds 16 MiB transfer limit")
            return {"path": payload["path"], "content": target.read_text()}
        if operation == "fs.readdir":
            return {"path": payload["path"], "entries": sorted(p.name for p in target.iterdir())}
        if operation == "fs.writeFile":
            if len(payload["content"].encode()) > MAX_FILE:
                raise ValueError("File exceeds 16 MiB transfer limit")
            ensure_dir(target.parent)
            target.write_text(payload["content"])
            own(target)
            alias(payload["path"])
        elif operation == "fs.mkdir":
            ensure_dir(target)
            alias(payload["path"])
        elif operation == "fs.unlink":
            if target == ROOT:
                raise ValueError("Cannot delete workspace root")
            if target.is_dir():
                shutil.rmtree(target)
            else:
                target.unlink()
        elif operation == "fs.rename":
            dest = path(payload["newPath"])
            ensure_dir(dest.parent)
            target.rename(dest)
            return {"oldPath": payload["oldPath"], "newPath": payload["newPath"]}
        else:
            raise ValueError("Unknown filesystem operation")
        return {"path": payload["path"]}
    if operation.startswith("npm."):
        command = "npm ls --depth=0 --json" if operation == "npm.list" else "npm install"
        if operation == "npm.install":
            command += " -- " + shlex.quote(payload["packageSpec"])
        if operation != "npm.list":
            # Flags precede the positional separator, preventing a package name
            # from becoming another npm CLI option.
            flag = " --save-dev" if payload.get("saveDev") else " --no-save" if payload.get("save") is False else ""
            command = command.replace("npm install", "npm install" + flag, 1)
            command += " && npm ls --depth=0 --json"
        result = start_command({"command": command, "commandTimeoutMs": 600000})
        record = PROCESSES[result["commandId"]]
        while record["child"].poll() is None:
            time.sleep(0.1)
        packages = {}
        text = command_result(record)["stdout"]
        try:
            packages = {name: value.get("version", "unknown") for name, value in json.loads(text[text.index("{"):]).get("dependencies", {}).items()}
        except (ValueError, KeyError):
            pass
        return {"success": record["child"].returncode == 0, "installed": packages, "packages": packages}
    if operation == "server.start":
        return start_server(payload)
    if operation == "server.stop":
        preview_port(payload["port"])
        info = SERVERS.pop(payload["port"], None)
        if info:
            stop(PROCESSES[info["commandId"]])
        else:
            # Servers launched from a terminal are discoverable and stoppable
            # too. Never signal root-owned guest infrastructure.
            stop_port(payload["port"])
        return {"port": payload["port"]}
    if operation in {"server.request", "server.handleSwRequest"}:
        return server_request(payload, operation == "server.handleSwRequest")
    if operation == "network.fetch":
        return network_fetch(payload)
    if operation == "ports.list":
        ports = set()
        for filename in ("/proc/net/tcp", "/proc/net/tcp6"):
            for line in pathlib.Path(filename).read_text().splitlines()[1:]:
                fields = line.split()
                if fields[3] == "0A":
                    port = int(fields[1].split(":")[1], 16)
                    if port not in RESERVED_PORTS and port >= 1024:
                        ports.add(port)
        return {"ports": sorted(ports)}
    if operation == "tunnel.open":
        port = preview_port(payload["port"])
        channel = str(uuid.uuid4())
        if len(CHANNELS) >= 128:
            raise ValueError("Too many preview connections")
        connection = socket.create_connection(("127.0.0.1", port), timeout=10)
        connection.settimeout(None)
        CHANNELS[channel] = connection
        resume = threading.Event()
        CHANNELS[channel + ":resume"] = resume
        def read_tunnel():
            try:
                while True:
                    data = connection.recv(32768)
                    if not data:
                        break
                    resume.clear()
                    SEND({"event": {"channel": channel, "data": base64.b64encode(data).decode()}})
                    if not resume.wait(60):
                        break
            finally:
                CHANNELS.pop(channel, None)
                CHANNELS.pop(channel + ":resume", None)
                connection.close()
                SEND({"event": {"channel": channel, "closed": True}})
        # Reader starts only after the host has registered its channel.
        CHANNELS[channel + ":reader"] = read_tunnel
        return {"channel": channel}
    if operation == "tunnel.start":
        threading.Thread(target=CHANNELS.pop(payload["channel"] + ":reader"), daemon=True).start()
        return {}
    if operation == "tunnel.write":
        CHANNELS[payload["channel"]].sendall(base64.b64decode(payload["data"], validate=True))
        return {}
    if operation == "tunnel.resume":
        resume = CHANNELS.get(payload["channel"] + ":resume")
        if resume:
            resume.set()
        return {}
    if operation == "tunnel.close":
        connection = CHANNELS.pop(payload["channel"], None)
        if connection:
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            connection.close()
        resume = CHANNELS.pop(payload["channel"] + ":resume", None)
        if resume:
            resume.set()
        return {}
    raise ValueError("Unsupported desktop sandbox operation: " + operation)


def main():
    global SEND
    ensure_dir(ROOT)
    STATE.mkdir(parents=True, exist_ok=True)
    setup_tools()
    hosts = pathlib.Path("/etc/hosts")
    if "memorall" not in hosts.read_text():
        with hosts.open("a") as output:
            output.write("\n127.0.1.1 memorall\n")
    # There is deliberately no NIC. The upstream cloud image waits for a
    # routable interface on first boot; subsequent starts must not repeat it.
    subprocess.run(["systemctl", "mask", "systemd-networkd-wait-online.service"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    control = os.open("/dev/virtio-ports/app.memorall.control", os.O_RDWR)
    def send(value):
        line = (json.dumps(pack(value), separators=(",", ":"), ensure_ascii=False) + "\n").encode()
        with SEND_LOCK:
            view = memoryview(line)
            while view:
                count = os.write(control, view)
                view = view[count:]
    SEND = send
    send({"event": {"kind": "runtime.ready", "instanceId": VFS_ID}})
    def proxy_client(connection):
        channel, ready = str(uuid.uuid4()), threading.Event()
        EGRESS[channel] = (connection, ready)
        try:
            send({"event": {"kind": "egress.open", "channel": channel}})
            if not ready.wait(30):
                return
            while channel in EGRESS:
                data = connection.recv(32768)
                if not data:
                    break
                send({"event": {"kind": "egress.data", "channel": channel, "data": base64.b64encode(data).decode()}})
        except OSError:
            pass
        finally:
            EGRESS.pop(channel, None)
            connection.close()
            send({"event": {"kind": "egress.close", "channel": channel}})
    def local_proxy():
        listener = socket.socket()
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", 3128))
        listener.listen(32)
        while True:
            connection, _ = listener.accept()
            if len(EGRESS) >= 32:
                connection.close()
                continue
            threading.Thread(target=proxy_client, args=(connection,), daemon=True).start()
    threading.Thread(target=local_proxy, daemon=True).start()
    def handle(frame):
        try:
            REQUEST_CONTEXT.id = frame["id"]
            result = dispatch(frame["operation"], unpack(frame.get("payload")))
            send({"id": frame["id"], "ok": True, "result": result})
        except Exception as error:
            send({"id": frame.get("id"), "ok": False, "error": str(error)})
        finally:
            with LOCK:
                CANCELLED_REQUESTS.discard(frame.get("id"))
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        buffer = b""
        while True:
            data = os.read(control, 65536)
            if not data:
                time.sleep(0.1)
                continue
            buffer += data
            if len(buffer) > 24 * 1024 * 1024:
                raise ValueError("Control frame exceeds limit")
            while b"\n" in buffer:
                line, buffer = buffer.split(b"\n", 1)
                frame = json.loads(line)
                if frame.get("operation") == "runtime.cancel":
                    handle(frame)
                else:
                    pool.submit(handle, frame)


if __name__ == "__main__":
    main()
