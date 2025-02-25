import { S3CoreDB } from '../src/S3CoreDB';
import { FileSystemStorageAdapter } from '../src/filesystem-storage-adapter';
import { AuthContext, Node } from '../src/types';
import { logger } from '../src/logger';

// Disable debug logging for cleaner output
logger.level = 'warn';

async function main() {
    const adapter = new FileSystemStorageAdapter('db-data');
    const db = new S3CoreDB({
        endpoint: "http://localhost:4566",
        accessKeyId: "test",
        secretAccessKey: "test",
        bucket: "test-bucket",
        s3ForcePathStyle: true
    }, adapter);

    console.log("🧹 Cleaning up old data...");
    await adapter.cleanup();

    db.setDefaultAuthContext({
        userPermissions: ["create", "read"],
        isAdmin: true
    });

    try {
        // Create Skills nodes first (they'll be referenced by other nodes)
        console.log("\n💡 Creating skill nodes...");
        const skills = {
            graphDB: await db.createNode({
                type: "skill",
                properties: {
                    name: "Graph Databases",
                    category: "Databases",
                    difficultyLevel: "advanced"
                },
                permissions: ["read"]
            }),
            ml: await db.createNode({
                type: "skill",
                properties: {
                    name: "Machine Learning",
                    category: "AI",
                    difficultyLevel: "advanced"
                },
                permissions: ["read"]
            }),
            coding: await db.createNode({
                type: "skill",
                properties: {
                    name: "Programming",
                    category: "Software Development",
                    difficultyLevel: "intermediate"
                },
                permissions: ["read"]
            })
        };

        // Create Learning Resources
        console.log("\n📚 Creating learning resource nodes...");
        const resources = {
            graphCourse: await db.createNode({
                type: "resource",
                properties: {
                    title: "Graph Database Fundamentals",
                    type: "course",
                    url: "https://example.com/graph-course",
                    level: "intermediate"
                },
                permissions: ["read"]
            }),
            mlBook: await db.createNode({
                type: "resource",
                properties: {
                    title: "Machine Learning Basics",
                    type: "book",
                    url: "https://example.com/ml-book",
                    level: "beginner"
                },
                permissions: ["read"]
            })
        };

        // Create Project nodes
        console.log("\n📋 Creating project nodes...");
        const projects = {
            graphML: await db.createNode({
                type: "project",
                properties: {
                    name: "Graph-Based ML Pipeline",
                    status: "active",
                    startDate: "2023-01-01",
                    description: "Implementing ML algorithms using graph database"
                },
                permissions: ["read"]
            }),
            dbResearch: await db.createNode({
                type: "project",
                properties: {
                    name: "Database Performance Research",
                    status: "planning",
                    startDate: "2023-06-01",
                    description: "Comparative analysis of graph databases"
                },
                permissions: ["read"]
            })
        };

        // Create users (similar to before, but now with direct skill references)
        console.log("\n📝 Creating users...");
        const alice = await db.createNode({
            type: "user",
            properties: { 
                name: "Alice", 
                interests: ["coding", "graph databases", "hiking", "photography"],
                location: "New York",
                skillLevel: "expert"
            },
            permissions: ["read"]
        });
        console.log(`Created user: ${alice.properties.name}`);

        const bob = await db.createNode({
            type: "user",
            properties: { 
                name: "Bob", 
                interests: ["photography", "databases", "travel"],
                location: "San Francisco",
                skillLevel: "intermediate"
            },
            permissions: ["read"]
        });
        console.log(`Created user: ${bob.properties.name}`);

        const charlie = await db.createNode({
            type: "user",
            properties: { 
                name: "Charlie", 
                interests: ["hiking", "coding", "machine learning"],
                location: "New York",
                skillLevel: "beginner"
            },
            permissions: ["read"]
        });
        console.log(`Created user: ${charlie.properties.name}`);

        const diana = await db.createNode({
            type: "user",
            properties: { 
                name: "Diana", 
                interests: ["graph databases", "machine learning", "travel"],
                location: "London",
                skillLevel: "expert"
            },
            permissions: ["read"]
        });
        console.log(`Created user: ${diana.properties.name}`);

        // Create rich relationships between nodes
        console.log("\n🤝 Creating relationship network...");
        
        // Skills relationships
        await db.createRelationship({
            from: alice.id,
            to: skills.graphDB.id,
            type: "HAS_SKILL",
            permissions: ["read"],
            properties: { level: "expert", yearsOfExperience: 5 }
        });

        // Project relationships
        await db.createRelationship({
            from: projects.graphML.id,
            to: skills.graphDB.id,
            type: "REQUIRES_SKILL",
            permissions: ["read"],
            properties: { requiredLevel: "advanced" }
        });

        await db.createRelationship({
            from: alice.id,
            to: projects.graphML.id,
            type: "LEADS",
            permissions: ["read"],
            properties: { 
                role: "Project Lead",
                since: "2023-01-01"
            }
        });

        // Resource relationships
        await db.createRelationship({
            from: resources.graphCourse.id,
            to: skills.graphDB.id,
            type: "TEACHES",
            permissions: ["read"],
            properties: { 
                completionTime: "20 hours",
                prerequisites: ["basic database knowledge"]
            }
        });

        // Alice follows Bob and Charlie
        await db.createRelationship({
            from: alice.id,
            to: bob.id,
            type: "FOLLOWS",
            permissions: ["read"],
            properties: { since: new Date().toISOString() }
        });
        await db.createRelationship({
            from: alice.id,
            to: charlie.id,
            type: "FOLLOWS",
            permissions: ["read"],
            properties: { since: new Date().toISOString() }
        });

        // Bob and Diana collaborate
        await db.createRelationship({
            from: bob.id,
            to: diana.id,
            type: "COLLABORATES",
            permissions: ["read"],
            properties: { 
                project: "Graph Database Research",
                started: new Date().toISOString()
            }
        });

        // Charlie mentors Diana
        await db.createRelationship({
            from: charlie.id,
            to: diana.id,
            type: "MENTORS",
            permissions: ["read"],
            properties: { 
                topic: "Machine Learning",
                started: new Date().toISOString()
            }
        });

        // Query Examples
        console.log("\n🔍 Finding users with common interests...");
        const users = [alice, bob, charlie, diana];
        
        for (const user1 of users) {
            for (const user2 of users) {
                if (user1.id !== user2.id) {
                    const commonInterests = user1.properties.interests.filter(
                        (interest: string) => user2.properties.interests.includes(interest)
                    );
                    if (commonInterests.length > 0) {
                        console.log(`${user1.properties.name} and ${user2.properties.name} share interests: ${commonInterests.join(', ')}`);
                    }
                }
            }
        }

        // Find users in the same location
        console.log("\n📍 Finding users in the same location...");
        const locations = new Map<string, string[]>();
        users.forEach(user => {
            const loc = user.properties.location;
            if (!locations.has(loc)) {
                locations.set(loc, []);
            }
            locations.get(loc)?.push(user.properties.name);
        });

        locations.forEach((names, location) => {
            if (names.length > 1) {
                console.log(`Users in ${location}: ${names.join(', ')}`);
            }
        });

        // Find all relationships for each user
        console.log("\n🕸️ Mapping user relationships...");
        for (const user of users) {
            console.log(`\nRelationships for ${user.properties.name}:`);
            
            // Cache auth context for multiple queries
            const readAuth = { userPermissions: ["read"] };

            // Get all relationship types at once
            const [follows, collaborations, mentoring, mentored] = await Promise.all([
                db.queryRelatedNodes(user.id, "FOLLOWS", readAuth, { direction: "OUT" }),
                db.queryRelatedNodes(user.id, "COLLABORATES", readAuth),
                db.queryRelatedNodes(user.id, "MENTORS", readAuth, { direction: "OUT" }),
                db.queryRelatedNodes(user.id, "MENTORS", readAuth, { direction: "IN" })
            ]);

            // Show relationships, excluding self-relationships
            follows.forEach(target => {
                if (target.id !== user.id) {
                    console.log(`- Follows ${target.properties.name}`);
                }
            });

            collaborations.forEach(collaborator => {
                if (collaborator.id !== user.id) {
                    console.log(`- Collaborates with ${collaborator.properties.name}`);
                }
            });

            mentoring.forEach(mentee => {
                if (mentee.id !== user.id) {
                    console.log(`- Mentors ${mentee.properties.name}`);
                }
            });

            mentored.forEach(mentor => {
                if (mentor.id !== user.id) {
                    console.log(`- Mentored by ${mentor.properties.name}`);
                }
            });
        }

        // Find potential collaborations with improved efficiency
        console.log("\n💡 Suggesting potential collaborations...");
        
        // Cache all existing collaborations
        const collaborationCache = new Map<string, Set<string>>();
        for (const user of users) {
            const collabs = await db.queryRelatedNodes(
                user.id,
                "COLLABORATES",
                { userPermissions: ["read"] }
            );
            collaborationCache.set(user.id, new Set(collabs.map(c => c.id)));
        }

        for (const user1 of users) {
            for (const user2 of users) {
                if (user1.id !== user2.id) {
                    const commonInterests = user1.properties.interests.filter(
                        (interest: string) => user2.properties.interests.includes(interest)
                    );
                    
                    const existing = collaborationCache.get(user1.id);
                    const alreadyCollaborating = existing?.has(user2.id) || false;

                    if (commonInterests.length >= 2 && !alreadyCollaborating) {
                        console.log(`\nSuggested collaboration between ${user1.properties.name} and ${user2.properties.name}`);
                        console.log(`  Common interests: ${commonInterests.join(', ')}`);
                        console.log(`  ${user1.properties.name}'s skill level: ${user1.properties.skillLevel}`);
                        console.log(`  ${user2.properties.name}'s skill level: ${user2.properties.skillLevel}`);
                        
                        // Add suggestion for mentor relationship if skill levels differ
                        const skillLevels = ['beginner', 'intermediate', 'expert'];
                        const user1SkillIndex = skillLevels.indexOf(user1.properties.skillLevel);
                        const user2SkillIndex = skillLevels.indexOf(user2.properties.skillLevel);
                        
                        if (Math.abs(user1SkillIndex - user2SkillIndex) > 0) {
                            const [mentor, mentee] = user1SkillIndex > user2SkillIndex ? 
                                [user1, user2] : [user2, user1];
                            console.log(`  💡 Suggestion: ${mentor.properties.name} could mentor ${mentee.properties.name}`);
                        }
                    }
                }
            }
        }

        // Enhanced queries
        console.log("\n🔍 Running enhanced queries...");

        // Find all skills required for a project
        console.log("\nSkills required for projects:");
        for (const [projectName, project] of Object.entries(projects)) {
            const requiredSkills = await db.queryRelatedNodes(
                project.id,
                "REQUIRES_SKILL",
                { userPermissions: ["read"] }
            );
            console.log(`${project.properties.name} requires:`);
            requiredSkills.forEach(skill => {
                console.log(`- ${skill.properties.name} (${skill.properties.difficultyLevel})`);
            });
        }

        // Find learning resources for skills
        console.log("\nAvailable learning resources by skill:");
        for (const [skillName, skill] of Object.entries(skills)) {
            const resources = await db.queryRelatedNodes(
                skill.id,
                "TEACHES",
                { userPermissions: ["read"] },
                { direction: "IN" }
            );
            if (resources.length > 0) {
                console.log(`\n${skill.properties.name}:`);
                resources.forEach(resource => {
                    console.log(`- ${resource.properties.title} (${resource.properties.type})`);
                });
            }
        }

        console.log("\n💾 Enhanced data model has been persisted to the 'db-data' directory.");

    } catch (error) {
        console.error("❌ Error in POC:", error);
        process.exit(1);
    }
}

main();