import api from "./axios";

export const createRun = async (payload = { name: "ReconAI Demo Benchmark", sourceMode: "SYNTHETIC" }) => {
  const res = await api.post("/reconciliation/runs", payload);
  return res.data.data;
};

export const getRuns = async (params = {}) => {
  const res = await api.get("/reconciliation/runs", { params });
  return res.data.data;
};

export const getRun = async (runId) => {
  const res = await api.get(`/reconciliation/runs/${runId}`);
  return res.data.data;
};

export const getRunResults = async (runId, params = {}) => {
  const res = await api.get(`/reconciliation/runs/${runId}/results`, { params });
  return res.data.data;
};

export const getRunMetrics = async (runId) => {
  const res = await api.get(`/reconciliation/runs/${runId}/metrics`);
  return res.data.data;
};

export const getRunEvaluation = async (runId, params = {}) => {
  const res = await api.get(`/reconciliation/runs/${runId}/evaluation`, { params });
  return res.data.data;
};
