export interface ShardConfig {
  strategy: "range" | "hash" | "date"; // The sharding strategy to use
  shardCount?: number; // Number of shards (for hash strategy)
  rangeSize?: number; // Size of each range (for range strategy)
  dateFormat?: string; // Date format for date-based sharding
  shardingKey?: string; // The key to use for sharding
}
