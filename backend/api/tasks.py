from fastapi import APIRouter, HTTPException
import asyncio
import functools
import contextvars
from typing import Dict, Any
import uuid

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

class TaskQueue:
    _queue = asyncio.Queue()
    _worker_task = None

    @classmethod
    async def enqueue(cls, func, *args, **kwargs):
        if cls._worker_task is None:
            cls._worker_task = asyncio.create_task(cls._worker())
        ctx = contextvars.copy_context()
        # Find task_id in args or kwargs (assuming it's usually passed)
        task_id = args[0] if args and isinstance(args[0], str) else kwargs.get('task_id')
        await cls._queue.put((task_id, func, args, kwargs, ctx))

    @classmethod
    async def _worker(cls):
        loop = asyncio.get_running_loop()
        while True:
            task_id, func, args, kwargs, ctx = await cls._queue.get()
            try:
                if task_id:
                    t = TaskManager.get_task(task_id)
                    if t and t.get("status") == "canceled":
                        continue

                if asyncio.iscoroutinefunction(func):
                    # Para coroutines seria ideal ctx.run mas asyncio lida melhor com tasks independentes
                    await func(*args, **kwargs)
                else:
                    pfunc = functools.partial(ctx.run, func, *args, **kwargs)
                    await loop.run_in_executor(None, pfunc)
            except Exception as e:
                print("Worker error:", e)
            finally:
                cls._queue.task_done()

class TaskManager:
    _tasks: Dict[str, Dict[str, Any]] = {}

    @classmethod
    def create_task(cls, action_id: str = None) -> str:
        task_id = str(uuid.uuid4())
        cls._tasks[task_id] = {
            "status": "queued",
            "progress": 0.0,
            "logs": [],
            "result": None,
            "action_id": action_id
        }
        return task_id

    @classmethod
    def has_active_task(cls, action_id: str) -> bool:
        if not action_id:
            return False
        for tid, t in cls._tasks.items():
            if t.get("action_id") == action_id and t.get("status") not in ["completed", "error", "canceled"]:
                return True
        return False

    @classmethod
    def cancel_task(cls, task_id: str):
        task = cls.get_task(task_id)
        if task and task.get("status") not in ["completed", "error"]:
            task["status"] = "canceled"
            if task["logs"]:
                task["logs"][-1]["done"] = True
            task["logs"].append({"text": "Processo cancelado pelo usuário.", "done": True})

    @classmethod
    def get_task(cls, task_id: str) -> Dict[str, Any]:
        return cls._tasks.get(task_id)

    @classmethod
    def update_task(cls, task_id: str, progress: float = None, log: str = None, status: str = None, result: Any = None):
        if task_id not in cls._tasks:
            return
            
        task = cls._tasks[task_id]
        
        if progress is not None:
            task["progress"] = progress
            
        if log is not None:
            if task["logs"]:
                task["logs"][-1]["done"] = True
            task["logs"].append({"text": log, "done": False})
            
        if status is not None:
            task["status"] = status
            if status in ["completed", "error"] and task["logs"]:
                task["logs"][-1]["done"] = True
                
        if result is not None:
            task["result"] = result

@router.get("/{task_id}")
def get_task_status(task_id: str):
    task = TaskManager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task não encontrada")
    return task

@router.delete("/{task_id}")
def cancel_task(task_id: str):
    task = TaskManager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task não encontrada")
    TaskManager.cancel_task(task_id)
    return {"message": "Tarefa cancelada com sucesso"}
