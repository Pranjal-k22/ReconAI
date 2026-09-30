import api from "./axios";

export const createControllerRun = async (payload = {
  name: "ReconAI Track 4 Demo",
  sourceMode: "SYNTHETIC",
  importBatchId: "BATCH-DEMO-V1",
  datasetVersion: "RECONAI_DEMO_V1",
  autoInvestigate: true
}) => {
  const res = await api.post("/finance-controller/run", payload);
  return res.data.data;
};

export const getControllerRuns = async (params = {}) => {
  const res = await api.get("/finance-controller/runs", { params });
  return res.data.data;
};

export const getControllerRun = async (runId) => {
  const res = await api.get(`/finance-controller/runs/${runId}`);
  return res.data.data;
};

export const getControllerRunReport = async (runId) => {
  const res = await api.get(`/finance-controller/runs/${runId}/report`);
  return res.data.data;
};

export const getControllerRunStatus = async (runId) => {
  const res = await api.get(`/finance-controller/runs/${runId}/status`);
  return res.data.data;
};
