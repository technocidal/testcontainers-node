import couchbase, { Bucket, Cluster } from "couchbase";
import { BucketDefinition } from "./bucket-definition";
import { CouchbaseContainer } from "./couchbase-container";
import { CouchbaseService } from "./couchbase-service";

describe("CouchbaseContainer", { timeout: 180_000 }, () => {
  // upsertAndGet {
  const upsertAndGet = async (
    bucket: Bucket,
    key: string,
    value: Record<string, string>
  ): Promise<couchbase.GetResult> => {
    const coll = bucket.defaultCollection();
    await coll.upsert(key, value);

    return coll.get(key);
  };
  // }

  const flushBucketAndCheckExists = async (
    cluster: Cluster,
    bucket: Bucket,
    key: string
  ): Promise<couchbase.ExistsResult> => {
    const coll = bucket.defaultCollection();

    await cluster.buckets().flushBucket(bucket.name);
    return coll.exists(key);
  };

  describe("Enterprise Image", () => {
    const COUCHBASE_IMAGE_ENTERPRISE = "couchbase/server:enterprise-7.0.3";

    // connectAndQuery {
    it("should connect and query using enterprise image", async () => {
      const bucketDefinition = new BucketDefinition("mybucket");
      const container = new CouchbaseContainer(COUCHBASE_IMAGE_ENTERPRISE).withBucket(bucketDefinition);

      await using startedTestContainer = await container.start();

      const cluster = await couchbase.Cluster.connect(startedTestContainer.getConnectionString(), {
        username: startedTestContainer.getUsername(),
        password: startedTestContainer.getPassword(),
      });

      const bucket = cluster.bucket(bucketDefinition.getName());
      const result = await upsertAndGet(bucket, "testdoc", { foo: "bar" });

      expect(result.content).toEqual({ foo: "bar" });
      await cluster.close();
    });
    // }

    it("should flush bucket if flushEnabled and check any document exists", async () => {
      const bucketDefinition = new BucketDefinition("mybucket").withFlushEnabled(true);
      const container = new CouchbaseContainer(COUCHBASE_IMAGE_ENTERPRISE).withBucket(bucketDefinition);

      await using startedTestContainer = await container.start();
      const cluster = await couchbase.Cluster.connect(startedTestContainer.getConnectionString(), {
        username: startedTestContainer.getUsername(),
        password: startedTestContainer.getPassword(),
      });

      const bucket = cluster.bucket(bucketDefinition.getName());
      const coll = bucket.defaultCollection();

      await coll.upsert("testdoc", { foo: "bar" });

      const existResult = await flushBucketAndCheckExists(cluster, bucket, "testdoc");

      expect(existResult.exists).toBe(false);
      await cluster.close();
    });
  });

  describe("Community Image", () => {
    const COUCHBASE_IMAGE_COMMUNITY = "couchbase/server:community-7.0.2";

    it("should connect and query using community image", async () => {
      const bucketDefinition = new BucketDefinition("mybucket");
      const container = new CouchbaseContainer(COUCHBASE_IMAGE_COMMUNITY).withBucket(bucketDefinition);

      await using startedTestContainer = await container.start();
      const cluster = await couchbase.Cluster.connect(startedTestContainer.getConnectionString(), {
        username: startedTestContainer.getUsername(),
        password: startedTestContainer.getPassword(),
      });

      const bucket = cluster.bucket(bucketDefinition.getName());
      const result = await upsertAndGet(bucket, "testdoc", { foo: "bar" });

      expect(result.content).toEqual({ foo: "bar" });
      await cluster.close();
    });

    it("should flush bucket if flushEnabled and check any document exists", async () => {
      const bucketDefinition = new BucketDefinition("mybucket").withFlushEnabled(true);
      const container = new CouchbaseContainer(COUCHBASE_IMAGE_COMMUNITY).withBucket(bucketDefinition);

      await using startedTestContainer = await container.start();
      const cluster = await couchbase.Cluster.connect(startedTestContainer.getConnectionString(), {
        username: startedTestContainer.getUsername(),
        password: startedTestContainer.getPassword(),
      });

      const bucket = cluster.bucket(bucketDefinition.getName());
      const coll = bucket.defaultCollection();

      await coll.upsert("testdoc", { foo: "bar" });

      const existResult = await flushBucketAndCheckExists(cluster, bucket, "testdoc");

      expect(existResult.exists).toBe(false);
      await cluster.close();
    });

    it("should throw error if analytics service enabled with community version", async () => {
      const container = new CouchbaseContainer(COUCHBASE_IMAGE_COMMUNITY).withEnabledServices(
        CouchbaseService.KV,
        CouchbaseService.ANALYTICS
      );

      await expect(() => container.start()).rejects.toThrowError(
        "The Analytics Service is only supported with the Enterprise version"
      );
    });

    it("should throw error if eventing service enabled with community version", async () => {
      const container = new CouchbaseContainer(COUCHBASE_IMAGE_COMMUNITY).withEnabledServices(
        CouchbaseService.KV,
        CouchbaseService.EVENTING
      );

      await expect(() => container.start()).rejects.toThrowError(
        "The Eventing Service is only supported with the Enterprise version"
      );
    });
  });
});
