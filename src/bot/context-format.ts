/** Prepend prepared context without coupling to external memory commands. */
export function weaveMemoryContext(text: string, context: string): string {
  return context.trim() ? `${context.trim()}\n\n${text}` : text;
}
