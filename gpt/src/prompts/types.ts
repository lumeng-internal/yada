export type Prompt = { id: string; title: string; content: string; createdAt: number; updatedAt: number };
export type PromptLibrary = { version: 2; prompts: Prompt[] };
