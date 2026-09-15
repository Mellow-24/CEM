/** Keyless external-model double and real session events for quality workflow tests. */
import { LlmAdapter, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { Session } from '@deepseek-ai/dsh-session';
import type { QualityTurnResult } from '../src/quality-types.ts';
export declare function seedQualityConversation(session: Session): void;
export declare function qualityAnswer(): {
    turns: QualityTurnResult[];
};
export declare class QualityAdapter extends LlmAdapter {
    requests: GenerateOptions[];
    answer: string;
    resolveModel(provider: string, model: string): Promise<{
        provider: string;
        id: string;
        name: string;
        reasoning: {
            efforts: {
                id: ReasoningEffortId;
                name: string;
            }[];
        };
    }>;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
//# sourceMappingURL=quality-fixture.d.ts.map