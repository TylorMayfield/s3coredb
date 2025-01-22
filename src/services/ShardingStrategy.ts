export interface ShardConfig {
  strategy: "hash" | "range" | "date";
  shardCount?: number; // For hash-based sharding
  rangeSize?: number; // For range-based sharding
  dateFormat?: string; // For date-based sharding (e.g., 'YYYY-MM' or 'YYYY')
}

export class ShardingStrategy {
  private config: ShardConfig;

  constructor(config: ShardConfig) {
    this.config = config;
  }

  calculateShard(table: string, id: string, timestamp?: Date): string {
    switch (this.config.strategy) {
      case "hash":
        return this.hashShard(table, id);
      case "range":
        return this.rangeShard(id);
      case "date":
        return this.dateShard(timestamp || new Date());
      default:
        throw new Error("Invalid sharding strategy");
    }
  }

  private hashShard(table: string, id: string): string {
    const shardCount = this.config.shardCount || 10;
    const hash = Array.from(id).reduce(
      (acc, char) => acc + char.charCodeAt(0),
      0
    );
    const shardNum = hash % shardCount;
    return `shard-${shardNum}`;
  }

  private rangeShard(id: string): string {
    const rangeSize = this.config.rangeSize || 1000;
    const numericId = parseInt(id, 36);
    const rangeNum = Math.floor(numericId / rangeSize);
    return `range-${rangeNum}`;
  }

  private dateShard(timestamp: Date): string {
    const format = this.config.dateFormat || "YYYY-MM";
    const year = timestamp.getFullYear();
    const month = String(timestamp.getMonth() + 1).padStart(2, "0");
    return format === "YYYY" ? `${year}` : `${year}-${month}`;
  }
}
