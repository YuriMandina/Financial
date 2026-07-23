from fastapi import APIRouter, HTTPException
from typing import Dict, Any
import uuid

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

class TaskManager:
    _tasks: Dict[str, Dict[str, Any]] = {}

    @classmethod
    def create_task(cls) -> str:
        task_id = str(uuid.uuid4())
        cls._tasks[task_id] = {
            "status": "running",
            "progress": 0.0,
            "logs": [],
            "result": None
        }
        return task_id

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
