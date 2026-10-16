import React, { createContext, useContext, useState, useCallback } from 'react';
import ProgressModal from '../components/common/ProgressModal';

// --- [BLOCO: Definição do Contexto e Hook de Tarefas] ---
const TaskSyncContext = createContext(null);

export const useTaskSync = () => {
  const context = useContext(TaskSyncContext);
  if (!context) {
    throw new Error('useTaskSync deve ser utilizado dentro de um TaskSyncProvider');
  }
  return context;
};

// --- [BLOCO: Provider e Orquestração de Tarefas Assíncronas] ---
export const TaskSyncProvider = ({ children, onNavigateMenu }) => {
  const [activeSyncTasks, setActiveSyncTasks] = useState([]);
  const [globalRefreshCounter, setGlobalRefreshCounter] = useState(0);

  const triggerGlobalRefresh = useCallback(() => {
    setGlobalRefreshCounter((prev) => prev + 1);
  }, []);

  const handleGlobalTaskStart = useCallback((taskId, title, onSuccess = null, status = 'processing', text = '') => {
    setActiveSyncTasks((prev) => {
      const existing = prev.find((t) => t.taskId === taskId);
      if (existing) {
        if (status === 'duplicate') {
          setTimeout(() => {
            setActiveSyncTasks((current) =>
              current.map((t) => (t.taskId === taskId ? { ...t, warning: null } : t))
            );
          }, 4000);
          return prev.map((t) => (t.taskId === taskId ? { ...t, warning: text } : t));
        }
        return prev;
      }
      if (status === 'duplicate') {
        return [...prev, { taskId, title, onSuccess, status: 'processing', text: '', active: true, warning: text }];
      }
      return [...prev, { taskId, title, onSuccess, status, text, active: true }];
    });
  }, []);

  const dismissTask = useCallback((taskId) => {
    setActiveSyncTasks((prev) => prev.filter((t) => t.taskId !== taskId));
  }, []);

  const handleTaskSuccess = useCallback((taskState, taskResult) => {
    if (typeof taskState.onSuccess === 'string') {
      if (onNavigateMenu) {
        onNavigateMenu(taskState.onSuccess);
      }
    } else if (typeof taskState.onSuccess === 'function') {
      taskState.onSuccess(taskResult);
    }
    triggerGlobalRefresh();
  }, [onNavigateMenu, triggerGlobalRefresh]);

  const value = {
    activeSyncTasks,
    globalRefreshCounter,
    triggerGlobalRefresh,
    handleGlobalTaskStart,
    dismissTask,
  };

  return (
    <TaskSyncContext.Provider value={value}>
      {children}
      {/* Container Flutuante de Tarefas Globais */}
      <div className="fixed bottom-6 right-6 flex flex-col gap-4 z-[100] items-end pointer-events-none">
        {activeSyncTasks.map((taskState) => (
          <div key={taskState.taskId} className="pointer-events-auto">
            <ProgressModal
              taskId={taskState.taskId?.startsWith('err-') ? null : taskState.taskId}
              manualState={taskState}
              onClose={() => dismissTask(taskState.taskId)}
              onSuccess={(result) => handleTaskSuccess(taskState, result)}
              title={taskState.title}
            />
          </div>
        ))}
      </div>
    </TaskSyncContext.Provider>
  );
};
