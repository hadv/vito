export const AI_CONFIG = {
  provider: 'gemini', // Set this to 'openai' or 'gemini' to switch providers
  openai: {
    modelName: 'gpt-4-turbo-preview',
    temperature: 0,
    maxTokens: 500,
  },
  gemini: {
    modelName: 'gemini-2.0-flash',
    temperature: 0,
    maxOutputTokens: 500,
  },
  // Add other AI model configurations here
  analysis: {
    confidenceThreshold: 0.7, // Minimum confidence level to mark as malicious
    batchSize: 10, // Maximum number of transactions to analyze in parallel
  },
}; 