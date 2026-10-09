export class BulkheadRejectedError extends Error {
  constructor(bulkhead: string, maxConcurrent: number) {
    super(`Bulkhead "${bulkhead}" is full (${maxConcurrent} concurrent calls)`);
    this.name = 'BulkheadRejectedError';
  }
}

export class Bulkhead {
  private active = 0;

  constructor(
    readonly name: string,
    readonly maxConcurrent: number,
  ) {}

  async execute<T>(action: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      throw new BulkheadRejectedError(this.name, this.maxConcurrent);
    }
    this.active++;
    try {
      return await action();
    } finally {
      this.active--;
    }
  }
}
