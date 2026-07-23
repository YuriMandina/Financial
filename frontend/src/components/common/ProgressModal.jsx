import React, { useEffect, useState, useRef } from 'react';
import { Loader2, CheckCircle2, XCircle, ChevronDown, Check } from 'lucide-react';

export default function ProgressModal({ taskId, onClose, manualState, onSuccess }) {
  const [task, setTask] = useState(null);
  const [error, setError] = useState(null);
  const [minimized, setMinimized] = useState(true);
  const logsEndRef = useRef(null);

  useEffect(() => {
    if (!taskId) return;

    let interval;
    
    const fetchTask = async () => {
      try {
        const response = await fetch(`http://localhost:8000/api/tasks/${taskId}`);
        if (!response.ok) throw new Error('Falha ao buscar task');
        const data = await response.json();
        setTask(data);
        
        if (data.status === 'completed' || data.status === 'error') {
          clearInterval(interval);
        }
      } catch (err) {
        console.error("Erro ao buscar task:", err);
        setError("Não foi possível acompanhar o progresso.");
        clearInterval(interval);
      }
    };

    fetchTask();
    interval = setInterval(fetchTask, 500);

    return () => clearInterval(interval);
  }, [taskId]);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [task?.logs, manualState?.text]);

  if (!taskId && !manualState?.active) return null;

  const isCompleted = taskId ? task?.status === 'completed' : manualState?.status === 'completed';
  const isError = taskId ? (task?.status === 'error' || error) : (manualState?.status === 'error' || error);
  const progress = taskId ? (task?.progress || 0) : (isCompleted ? 100 : (isError ? 0 : 50));
  
  const displayLogs = taskId 
    ? task?.logs 
    : (manualState?.text ? [{ text: manualState.text, done: isCompleted }] : []);

  if (minimized) {
    return (
      <div 
        className="fixed bottom-6 right-6 z-[100] bg-white rounded-2xl shadow-2xl p-4 flex items-center gap-4 cursor-pointer hover:scale-105 transition-transform border border-slate-100" 
        onClick={() => setMinimized(false)}
      >
        {isCompleted ? (
          <CheckCircle2 className="w-8 h-8 text-green-500" />
        ) : isError ? (
          <XCircle className="w-8 h-8 text-red-500" />
        ) : (
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        )}
        <div className="flex flex-col pr-4">
          <span className="text-sm font-bold text-slate-800">
            {isCompleted ? 'Concluído!' : isError ? 'Erro' : 'Sincronizando...'}
          </span>
          <span className="text-xs text-slate-500 font-medium">
            {taskId ? Math.round(progress) : (isCompleted ? 100 : (isError ? 0 : '...'))}% • Clique para abrir
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* HEADER */}
        <div className="relative bg-gradient-to-r from-blue-600 to-indigo-700 p-6 text-white text-center flex-shrink-0">
          {!isCompleted && !isError && (
             <button 
               onClick={() => setMinimized(true)} 
               className="absolute top-4 right-4 bg-white/10 p-1 rounded-lg text-white/70 hover:text-white hover:bg-white/20 transition"
               title="Minimizar para o fundo"
             >
               <ChevronDown className="w-6 h-6" />
             </button>
          )}
          <div className="flex justify-center mb-4">
            {isCompleted ? (
              <div className="bg-white/20 p-3 rounded-full">
                <Check className="w-10 h-10 text-white" />
              </div>
            ) : isError ? (
              <div className="bg-white/20 p-3 rounded-full">
                <XCircle className="w-10 h-10 text-white" />
              </div>
            ) : (
              <div className="bg-white/20 p-3 rounded-full">
                <Loader2 className="w-10 h-10 text-white animate-spin" />
              </div>
            )}
          </div>
          <h2 className="text-2xl font-bold mb-1">
            {isCompleted ? 'Processo Concluído!' : isError ? 'Ocorreu um Erro' : 'Processando...'}
          </h2>
          <p className="text-blue-100 text-sm">
            {isCompleted ? 'A operação foi finalizada com sucesso.' : isError ? 'Infelizmente a operação falhou.' : 'Por favor, aguarde enquanto sincronizamos os dados.'}
          </p>
        </div>

        {/* PROGRESS BAR */}
        <div className="px-6 pt-6 flex-shrink-0">
          <div className="flex justify-between text-sm font-medium text-gray-700 mb-2">
            <span>Progresso</span>
            <span>{taskId ? Math.round(progress) : (isCompleted ? 100 : (isError ? 0 : '...'))}%</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden shadow-inner">
            <div 
              className={`h-full transition-all duration-500 ease-out rounded-full ${isError ? 'bg-red-500' : 'bg-gradient-to-r from-blue-500 to-indigo-500'} ${!taskId && !isCompleted && !isError ? 'w-full animate-pulse' : ''}`}
              style={{ width: taskId || isCompleted || isError ? `${progress}%` : '100%' }}
            ></div>
          </div>
        </div>

        {/* LOGS */}
        <div className="p-6 flex-1 overflow-y-auto min-h-[200px]">
          <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <ChevronDown className="w-4 h-4 text-gray-400" /> Detalhes do Processo
          </h3>
          
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 font-mono text-sm space-y-3">
            {!task && !error && !manualState && (
              <div className="flex items-center text-gray-400 gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Inicializando tarefa...
              </div>
            )}
            
            {error && !taskId && (
              <div className="flex items-start text-red-600 gap-2">
                <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {error}
              </div>
            )}

            {displayLogs?.map((log, index) => (
              <div 
                key={index} 
                className={`flex items-start gap-2 ${
                  log.done 
                    ? 'text-gray-600' 
                    : isError 
                      ? 'text-red-600' 
                      : 'text-blue-600 font-medium'
                }`}
              >
                {log.done ? (
                  <CheckCircle2 className="w-4 h-4 mt-0.5 text-green-500 flex-shrink-0" />
                ) : isError ? (
                  <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-500" />
                ) : (
                  <Loader2 className="w-4 h-4 mt-0.5 animate-spin flex-shrink-0" />
                )}
                <span className="leading-tight">{log.text}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>

        {/* FOOTER (BUTTONS) */}
        {(isCompleted || isError) && (
          <div className="px-6 pb-6 pt-2 flex-shrink-0">
            <button
              onClick={() => {
                if (isCompleted && onSuccess) {
                  onSuccess();
                }
                onClose();
              }}
              className={`w-full py-3 px-4 rounded-xl font-medium text-white shadow-lg transition-transform hover:scale-[1.02] active:scale-95 ${
                isCompleted 
                  ? 'bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 shadow-green-500/30' 
                  : 'bg-gradient-to-r from-gray-700 to-gray-800 hover:from-gray-800 hover:to-gray-900 shadow-gray-500/30'
              }`}
            >
              {isCompleted ? 'Continuar' : 'Fechar'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
