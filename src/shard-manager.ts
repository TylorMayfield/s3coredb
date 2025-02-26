import crypto from 'crypto';

export class ShardManager {
    private numShards: number;
    private shardLevels: number;

    constructor(numShards: number = 256, shardLevels: number = 2) {
        this.numShards = numShards;
        this.shardLevels = shardLevels;
    }

    getShardPath(id: string): string {
        // Generate a SHA-256 hash of the ID
        const hash = crypto.createHash('sha256').update(id).digest('hex');
        
        // Use the first few characters of the hash for each shard level
        const shardDirs: string[] = [];
        for (let i = 0; i < this.shardLevels; i++) {
            const shardNum = parseInt(hash.substring(i * 2, (i + 1) * 2), 16) % this.numShards;
            shardDirs.push(shardNum.toString().padStart(3, '0'));
        }
        
        return shardDirs.join('/');
    }

    getShardPathForType(type: string, id: string): string {
        return `${type}/${this.getShardPath(id)}`;
    }

    getShardPathForRelationship(type: string, fromId: string, toId: string): string {
        // Use a combination of both IDs for relationship sharding
        const combinedId = `${fromId}__${toId}`;
        return `${type}/${this.getShardPath(combinedId)}`;
    }
}