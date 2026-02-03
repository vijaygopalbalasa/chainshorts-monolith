import type { ReactionType } from "../types/reaction.js";

export function createReactionSigningMessage(input: {
  articleId: string;
  reactionType: ReactionType;
  nonce: string;
}): string {
  return `CHAINSHORTS_REACTION\narticle:${input.articleId}\nreaction:${input.reactionType}\nnonce:${input.nonce}`;
}
