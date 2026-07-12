#!/usr/bin/env python3
"""Read one private file through an inherited directory fd."""

import argparse
import os
import stat
import sys


def fail(code, status=2):
    sys.stderr.write(f"{code}\n")
    raise SystemExit(status)


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--dir-fd", type=int, required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--mode", required=True)
    parser.add_argument("--max-bytes", type=int, required=True)
    args = parser.parse_args()
    if not args.name or args.name in (".", "..") or "/" in args.name or "\\" in args.name or "\x00" in args.name:
        fail("MIGRATION_FILE_NAME_INVALID")
    expected_mode = None if args.mode == "any" else int(args.mode, 8)
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(args.name, flags, dir_fd=args.dir_fd)
    except FileNotFoundError:
        fail("MIGRATION_FILE_NOT_FOUND", 3)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode):
            fail("MIGRATION_FILE_REQUIRED")
        if before.st_nlink != 1:
            fail("MIGRATION_FILE_LINK_COUNT_UNSAFE")
        if expected_mode is not None and stat.S_IMODE(before.st_mode) != expected_mode:
            fail("MIGRATION_FILE_PERMISSION_UNSAFE")
        chunks = []
        total = 0
        while True:
            chunk = os.read(fd, min(1024 * 1024, args.max_bytes + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > args.max_bytes:
                fail("MIGRATION_FILE_TOO_LARGE")
        after = os.fstat(fd)
        first = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_nlink, stat.S_IMODE(before.st_mode))
        second = (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_nlink, stat.S_IMODE(after.st_mode))
        if first != second:
            fail("MIGRATION_FILE_CHANGED")
        sys.stdout.buffer.write(b"".join(chunks))
    finally:
        os.close(fd)


if __name__ == "__main__":
    main()
