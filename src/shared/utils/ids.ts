let counter = 0;

export function generateId(prefix: string = 'id'): string {
  counter++;
  return `${prefix}_${Date.now()}_${counter}`;
}
