import asyncio
import re
import time


TASK_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,128}$")
MAX_TERMINAL_RECORDS = 1000


class DownloadTaskRegistry:
    def __init__(self):
        self._records = {}
        self._lock = asyncio.Lock()

    def validate_task_id(self, task_id):
        value = str(task_id or "").strip()
        if not TASK_ID_PATTERN.fullmatch(value):
            raise ValueError("invalid task_id")
        return value

    async def run(self, task_id, coroutine_factory):
        task_id = self.validate_task_id(task_id)
        async with self._lock:
            existing = self._records.get(task_id)
            if existing and not existing["task"].done():
                raise RuntimeError("download task already running")
            task = asyncio.create_task(coroutine_factory(), name=f"video-download:{task_id}")
            record = {
                "task": task,
                "state": "running",
                "createdAt": int(time.time() * 1000),
                "finishedAt": None,
                "errorCode": None,
            }
            self._records[task_id] = record
            task.add_done_callback(lambda completed: self._complete(task_id, completed))
            self._trim_terminal_unlocked()
        return await asyncio.shield(task)

    def _complete(self, task_id, task):
        record = self._records.get(task_id)
        if not record or record["task"] is not task:
            return
        record["finishedAt"] = int(time.time() * 1000)
        if task.cancelled():
            record["state"] = "cancelled"
            record["errorCode"] = "cancelled"
            return
        error = task.exception()
        if error is not None:
            record["state"] = "failed"
            record["errorCode"] = "download_failed"
            return
        record["state"] = "succeeded"

    async def cancel(self, task_id):
        task_id = self.validate_task_id(task_id)
        record = self._records.get(task_id)
        if not record:
            return self.public_status(task_id)
        task = record["task"]
        if not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        await asyncio.sleep(0)
        return self.public_status(task_id)

    def public_status(self, task_id):
        task_id = self.validate_task_id(task_id)
        record = self._records.get(task_id)
        if not record:
            return {
                "taskId": task_id,
                "state": "not_found",
                "terminal": True,
                "errorCode": "not_found",
            }
        state = record["state"]
        return {
            "taskId": task_id,
            "state": state,
            "terminal": state in {"succeeded", "failed", "cancelled"},
            "errorCode": record["errorCode"],
        }

    def _trim_terminal_unlocked(self):
        terminal = [
            (task_id, record)
            for task_id, record in self._records.items()
            if record["state"] != "running"
        ]
        if len(terminal) <= MAX_TERMINAL_RECORDS:
            return
        terminal.sort(key=lambda item: item[1]["finishedAt"] or 0)
        for task_id, _ in terminal[: len(terminal) - MAX_TERMINAL_RECORDS]:
            self._records.pop(task_id, None)


download_task_registry = DownloadTaskRegistry()
