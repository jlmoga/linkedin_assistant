/**
 * Application State
 */

export const state = {
  db: null,
  analysisAbortController: null,
  activeModel: 'gemini-pro-latest',
  originalProfileData: {},
  stagedCvFile: null,
  isAnalysingCv: false,
  currentJobAnalysis: null,
  escoCache: {
    search: new Map(),
    resource: new Map()
  }
};
