import type { ChatCompletionChunk } from 'openai/resources'

type LlamaDelta = ChatCompletionChunk.Choice.Delta & {
    reasoning_content?: string
}

type LlamaChoice = Omit<ChatCompletionChunk.Choice, 'delta'> & {
    delta: LlamaDelta
}

export type LlamaChunk = Omit<ChatCompletionChunk, 'choices'> & {
    choices: LlamaChoice[]
}
