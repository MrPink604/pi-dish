import type { createPromptDelivery } from '../../src/browser/prompt-delivery';
import type { createComposerSubmit } from '../../src/browser/composer-submit';
declare const delivery: ReturnType<typeof createPromptDelivery>;
declare const submit: ReturnType<typeof createComposerSubmit>;
// @ts-expect-error queue snapshots cannot be mutated by callers
delivery.queue.followUp.push('foreign');
// @ts-expect-error delivery acknowledgement is a boolean state transition
delivery.acknowledge('prompt', 'queued');
// @ts-expect-error queue delivery only accepts supported endpoint kinds
submit.sendQueuedMessage('foreign');
