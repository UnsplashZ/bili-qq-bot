#!/usr/bin/env python3
"""Directory-fd atomic writer. File content is accepted only through stdin."""

import argparse
import os
import secrets
import stat
import sys


def fail(code):
    sys.stderr.write(f"{code}\n")
    raise SystemExit(2)


def parse_args():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--dir-fd", type=int, required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--mode", required=True)
    parser.add_argument("--no-overwrite", action="store_true")
    return parser.parse_args()


def assert_safe_name(name):
    if not name or name in (".", "..") or "/" in name or "\\" in name or "\x00" in name:
        fail("MIGRATION_ATOMIC_NAME_INVALID")


def assert_safe_existing(dir_fd, name, allow_missing=True):
    try:
        value = os.stat(name, dir_fd=dir_fd, follow_symlinks=False)
    except FileNotFoundError:
        if allow_missing:
            return None
        raise
    if not stat.S_ISREG(value.st_mode):
        fail("MIGRATION_FILE_REQUIRED")
    if value.st_nlink != 1:
        fail("MIGRATION_FILE_LINK_COUNT_UNSAFE")
    return value


def main():
    args = parse_args()
    assert_safe_name(args.name)
    try:
        mode = int(args.mode, 8)
    except ValueError:
        fail("MIGRATION_ATOMIC_MODE_INVALID")
    if mode < 0 or mode > 0o777:
        fail("MIGRATION_ATOMIC_MODE_INVALID")

    dir_fd = args.dir_fd
    directory = os.fstat(dir_fd)
    if not stat.S_ISDIR(directory.st_mode):
        fail("MIGRATION_DIRECTORY_REQUIRED")
    existing = assert_safe_existing(dir_fd, args.name)
    if existing is not None and args.no_overwrite:
        fail("MIGRATION_TARGET_EXISTS")

    temp_name = f".{args.name}.{os.getpid()}.{secrets.token_hex(8)}.tmp"
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    flags |= getattr(os, "O_NOFOLLOW", 0)
    temp_fd = None
    installed = False
    try:
        temp_fd = os.open(temp_name, flags, mode, dir_fd=dir_fd)
        while True:
            chunk = sys.stdin.buffer.read(1024 * 1024)
            if not chunk:
                break
            view = memoryview(chunk)
            while view:
                written = os.write(temp_fd, view)
                view = view[written:]
        os.fchmod(temp_fd, mode)
        os.fsync(temp_fd)
        os.close(temp_fd)
        temp_fd = None

        # Recheck immediately before installation. O_NOFOLLOW on the temp and
        # the inherited directory fd keep lookup anchored to the original dir.
        assert_safe_existing(dir_fd, args.name)
        if args.no_overwrite:
            os.link(
                temp_name,
                args.name,
                src_dir_fd=dir_fd,
                dst_dir_fd=dir_fd,
                follow_symlinks=False,
            )
            os.unlink(temp_name, dir_fd=dir_fd)
        else:
            os.replace(temp_name, args.name, src_dir_fd=dir_fd, dst_dir_fd=dir_fd)
        installed = True

        target_flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        target_fd = os.open(args.name, target_flags, dir_fd=dir_fd)
        try:
            target = os.fstat(target_fd)
            if not stat.S_ISREG(target.st_mode) or target.st_nlink != 1:
                fail("MIGRATION_ATOMIC_TARGET_UNSAFE")
            os.fchmod(target_fd, mode)
            os.fsync(target_fd)
        finally:
            os.close(target_fd)
        os.fsync(dir_fd)
    except FileExistsError:
        fail("MIGRATION_TARGET_EXISTS")
    finally:
        if temp_fd is not None:
            os.close(temp_fd)
        if not installed:
            try:
                os.unlink(temp_name, dir_fd=dir_fd)
            except FileNotFoundError:
                pass


if __name__ == "__main__":
    main()
