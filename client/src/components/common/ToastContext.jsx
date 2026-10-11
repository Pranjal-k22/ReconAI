import React, { createContext, useContext, useState, useCallback } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((msgOrObj, type = "info", duration = 4000) => {
    const id = Date.now() + Math.random();
    let messageStr = "";
    let titleStr = null;
    let toastType = type;
    let toastDuration = duration;

    if (typeof msgOrObj === "object" && msgOrObj !== null) {
      titleStr = msgOrObj.title || null;
      messageStr = msgOrObj.message || "";
      toastType = msgOrObj.type || type;
      if (msgOrObj.duration) toastDuration = msgOrObj.duration;
    } else {
      messageStr = String(msgOrObj || "");
    }

    setToasts((prev) => [...prev, { id, title: titleStr, message: messageStr, type: toastType }]);

    if (toastDuration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, toastDuration);
    }
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 p-4 rounded-xl border shadow-lg transition-all animate-in fade-in slide-in-from-bottom-2 ${
              toast.type === "success"
                ? "bg-emerald-900 text-emerald-50 border-emerald-800"
                : toast.type === "error"
                ? "bg-rose-900 text-rose-50 border-rose-800"
                : toast.type === "warning"
                ? "bg-amber-900 text-amber-50 border-amber-800"
                : "bg-slate-900 text-slate-50 border-slate-800"
            }`}
          >
            {toast.type === "success" ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
            ) : toast.type === "error" ? (
              <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
            ) : (
              <Info className="w-5 h-5 text-indigo-400 flex-shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              {toast.title && <strong className="block font-semibold text-xs mb-0.5">{toast.title}</strong>}
              <p className="text-xs font-medium leading-relaxed">{toast.message}</p>
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-slate-400 hover:text-white p-0.5 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    return { addToast: () => {} };
  }
  return context;
}

