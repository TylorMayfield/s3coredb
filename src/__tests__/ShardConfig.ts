import { ShardConfig } from "../types/ShardConfig";
import { S3Operations } from "../services/S3Operations";

describe("ShardConfig Type", () => {
  test("should accept valid hash strategy configuration", () => {
    const config: ShardConfig = {
      strategy: "hash",
      shardCount: 10,
      shardingKey: "userId",
    };
    expect(config.strategy).toBe("hash");
    expect(config.shardCount).toBe(10);
  });

  test("should accept valid range strategy configuration", () => {
    const config: ShardConfig = {
      strategy: "range",
      rangeSize: 1000,
      shardingKey: "score",
    };
    expect(config.strategy).toBe("range");
    expect(config.rangeSize).toBe(1000);
  });

  test("should accept valid date strategy configuration", () => {
    const config: ShardConfig = {
      strategy: "date",
      dateFormat: "YYYY-MM",
      shardingKey: "createdAt",
    };
    expect(config.strategy).toBe("date");
    expect(config.dateFormat).toBe("YYYY-MM");
  });

  test("should work with minimal configuration", () => {
    const config: ShardConfig = {
      strategy: "hash",
    };
    expect(config.strategy).toBe("hash");
  });
});
