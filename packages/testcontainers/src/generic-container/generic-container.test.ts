import getPort from "get-port";
import path from "path";
import { RandomUuid } from "../common";
import { getContainerRuntimeClient } from "../container-runtime";
import { PullPolicy } from "../utils/pull-policy";
import {
  checkContainerIsHealthy,
  checkContainerIsHealthyUdp,
  getDockerEventStream,
  getRunningContainerNames,
  waitForDockerEvent,
} from "../utils/test-helper";
import { Wait } from "../wait-strategies/wait";
import { GenericContainer } from "./generic-container";

describe("GenericContainer", { timeout: 180_000 }, () => {
  const fixtures = path.resolve(__dirname, "..", "..", "fixtures", "docker");

  it("should return first mapped port", async () => {
    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withExposedPorts(8080)
      .start();

    expect(container.getFirstMappedPort()).toBe(container.getMappedPort(8080));
  });

  it("should return first mapped port with regardless of protocol", async () => {
    await using container = await new GenericContainer("mendhak/udp-listener")
      .withWaitStrategy(Wait.forLogMessage("Listening on UDP port 5005"))
      .withExposedPorts("5005/udp")
      .start();

    await checkContainerIsHealthyUdp(container);
    expect(container.getFirstMappedPort()).toBe(container.getMappedPort("5005/udp"));
    expect(container.getFirstMappedPort()).toBe(container.getMappedPort(5005, "udp"));
  });

  it("should bind to specified host port", async () => {
    const hostPort = await getPort();
    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withExposedPorts({
        container: 8080,
        host: hostPort,
      })
      .start();

    await checkContainerIsHealthy(container);
    expect(container.getMappedPort(8080)).toBe(hostPort);
  });

  it("should bind to specified host port with a different protocol", async () => {
    const hostPort = await getPort();
    await using container = await new GenericContainer("mendhak/udp-listener")
      .withWaitStrategy(Wait.forLogMessage("Listening on UDP port 5005"))
      .withExposedPorts({
        container: 5005,
        host: hostPort,
        protocol: "udp",
      })
      .start();

    await checkContainerIsHealthyUdp(container);
    expect(container.getMappedPort("5005/udp")).toBe(hostPort);
    expect(container.getMappedPort(5005, "udp")).toBe(hostPort);
  });

  it("should execute a command on a running container", async () => {
    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withExposedPorts(8080)
      .start();

    const { output, stdout, stderr, exitCode } = await container.exec(["echo", "hello", "world"]);

    expect(exitCode).toBe(0);
    expect(stdout).toEqual(expect.stringContaining("hello world"));
    expect(stderr).toBe("");
    expect(output).toEqual(stdout);
  });

  it("should execute a command in a different working directory", async () => {
    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withExposedPorts(8080)
      .start();

    const { output, stdout, stderr, exitCode } = await container.exec(["pwd"], { workingDir: "/var/log" });

    expect(exitCode).toBe(0);
    expect(stdout).toEqual(expect.stringContaining("/var/log"));
    expect(stderr).toBe("");
    expect(output).toEqual(stdout);
  });

  it("should execute a command with custom environment variables", async () => {
    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withExposedPorts(8080)
      .start();

    const { output, stdout, stderr, exitCode } = await container.exec(["env"], { env: { TEST_ENV: "test" } });

    expect(exitCode).toBe(0);
    expect(stdout).toEqual(expect.stringContaining("TEST_ENV=test"));
    expect(stderr).toBe("");
    expect(output).toEqual(stdout);
  });

  it("should execute a command with a different user", async () => {
    // By default, node:alpine runs as root
    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withExposedPorts(8080)
      .start();

    const { output, stdout, stderr, exitCode } = await container.exec(["whoami"], { user: "node" });

    expect(exitCode).toBe(0);
    expect(stdout).toEqual(expect.stringContaining("node"));
    expect(stderr).toBe("");
    expect(output).toEqual(stdout);
  });

  it("should capture stderr when a command fails", async () => {
    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withExposedPorts(8080)
      .start();

    const { output, stdout, stderr, exitCode } = await container.exec(["ls", "/nonexistent/path"]);

    expect(exitCode).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toEqual(expect.stringContaining("No such file or directory"));
    expect(output).toEqual(stderr);
  });

  it("should capture stdout and stderr in the correct order", async () => {
    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withExposedPorts(8080)
      .start();

    // The command first writes to stdout and then tries to access a nonexistent file (stderr)
    const { output, stdout, stderr, exitCode } = await container.exec([
      "sh",
      "-c",
      "echo 'This is stdout'; ls /nonexistent/path",
    ]);

    expect(exitCode).not.toBe(0); // The command should fail due to the ls error
    expect(stdout).toEqual(expect.stringContaining("This is stdout"));
    expect(stderr).toEqual(expect.stringContaining("No such file or directory"));
    expect(output).toEqual(expect.stringContaining("This is stdout"));
    expect(output).toEqual(expect.stringContaining("No such file or directory"));
  });

  it("should set environment variables", async () => {
    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withEnvironment({ customKey: "customValue" })
      .withExposedPorts(8080)
      .start();

    const url = `http://${container.getHost()}:${container.getMappedPort(8080)}`;
    const response = await fetch(`${url}/env`);
    const responseBody = (await response.json()) as { [key: string]: string };
    expect(responseBody.customKey).toBe("customValue");
  });

  it("should set command", async () => {
    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withCommand(["node", "index.js", "one", "two", "three"])
      .withExposedPorts(8080)
      .start();

    const url = `http://${container.getHost()}:${container.getMappedPort(8080)}`;
    const response = await fetch(`${url}/cmd`);
    const responseBody = await response.json();
    expect(responseBody).toEqual(["/usr/local/bin/node", "/index.js", "one", "two", "three"]);
  });

  it("should set working directory", async () => {
    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withWorkingDir("/tmp")
      .withCommand(["node", "../index.js"])
      .withExposedPorts(8080)
      .start();

    const { output } = await container.exec(["pwd"]);
    expect(output).toEqual(expect.stringContaining("/tmp"));
  });

  it("should set platform", async () => {
    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withPullPolicy(PullPolicy.alwaysPull())
      .withCommand(["node", "../index.js"])
      .withPlatform("linux/amd64")
      .withExposedPorts(8080)
      .start();

    const { output } = await container.exec(["arch"]);
    expect(output).toEqual(expect.stringContaining("x86_64"));
  });

  it("should set entrypoint", async () => {
    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withEntrypoint(["node"])
      .withCommand(["index.js"])
      .withExposedPorts(8080)
      .start();

    await checkContainerIsHealthy(container);
  });

  it("should set name", async () => {
    const containerName = "special-test-container";
    const expectedContainerName = "/special-test-container";
    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withName(containerName)
      .start();

    expect(container.getName()).toEqual(expectedContainerName);
  });

  it("should set labels", async () => {
    const labels = {
      ["label-1"]: "value-1",
      ["label-2"]: "value-2",
    };

    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withLabels(labels)
      .start();

    expect(container.getLabels()).toMatchObject(labels);
  });

  it("should set bind mounts", async () => {
    const filename = "test.txt";
    const source = path.resolve(fixtures, "docker", filename);
    const target = `/tmp/${filename}`;

    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withBindMounts([{ source, target }])
      .withExposedPorts(8080)
      .start();

    const { output } = await container.exec(["cat", target]);
    expect(output).toContain("hello world");
  });

  it("should set tmpfs", async () => {
    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withTmpFs({ "/testtmpfs": "rw" })
      .withExposedPorts(8080)
      .start();

    const tmpFsFile = "/testtmpfs/test.file";

    const { exitCode: exitCode1 } = await container.exec(["ls", tmpFsFile]);
    expect(exitCode1).toBe(1);

    await container.exec(["touch", tmpFsFile]);
    const { exitCode: exitCode2 } = await container.exec(["ls", tmpFsFile]);
    expect(exitCode2).toBe(0);
  });

  if (!process.env["CI_ROOTLESS"]) {
    it("should set ulimits", async () => {
      await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
        .withUlimits({ memlock: { hard: -1, soft: -1 } })
        .withExposedPorts(8080)
        .start();

      const { output } = await container.exec(["sh", "-c", "ulimit -l"]);
      expect(output.trim()).toBe("unlimited");
    });
  }

  it("should add capabilities", async () => {
    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withAddedCapabilities("IPC_LOCK")
      .withExposedPorts(8080)
      .start();

    const { output } = await container.exec(["sh", "-c", "getpcaps 1 2>&1"]);
    expect(output).toContain("cap_ipc_lock");
  });

  it("should drop capabilities", async () => {
    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withDroppedCapabilities("CHOWN")
      .withExposedPorts(8080)
      .start();

    const { output } = await container.exec(["sh", "-c", "getpcaps 1 2>&1"]);
    expect(output).not.toContain("cap_chown");
  });

  it("should set default log driver", async () => {
    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withDefaultLogDriver()
      .start();

    const client = await getContainerRuntimeClient();
    const dockerContainer = client.container.getById(container.getId());
    const containerInfo = await dockerContainer.inspect();
    expect(containerInfo.HostConfig.LogConfig).toEqual(
      expect.objectContaining({
        Type: "json-file",
      })
    );
  });

  it("should set privileged mode", async () => {
    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withPrivilegedMode()
      .withExposedPorts(8080)
      .start();

    const client = await getContainerRuntimeClient();
    const dockerContainer = client.container.getById(container.getId());
    const containerInfo = await dockerContainer.inspect();
    expect(containerInfo.HostConfig.Privileged).toBe(true);
    await checkContainerIsHealthy(container);
  });

  it("should use pull policy", async () => {
    const container = new GenericContainer("cristianrgreco/testcontainer:1.1.14").withExposedPorts(8080);

    await using _ = await container.start();

    {
      await using dockerEventStream = await getDockerEventStream();
      const dockerPullEventPromise = waitForDockerEvent(dockerEventStream.events, "pull");
      await using _ = await container.withPullPolicy(PullPolicy.alwaysPull()).start();
      await dockerPullEventPromise;
    }
  });

  it("should set the IPC mode", async () => {
    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withIpcMode("host")
      .withExposedPorts(8080)
      .start();

    await checkContainerIsHealthy(container);
  });

  it("should set the user", async () => {
    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withUser("node")
      .withExposedPorts(8080)
      .start();

    const { output } = await container.exec(["whoami"]);

    expect(output).toEqual(expect.stringContaining("node"));
  });

  it("should copy file to container", async () => {
    const source = path.resolve(fixtures, "docker", "test.txt");
    const target = "/tmp/test.txt";

    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withCopyFilesToContainer([{ source, target }])
      .withExposedPorts(8080)
      .start();

    expect((await container.exec(["cat", target])).output).toEqual(expect.stringContaining("hello world"));
  });

  it("should copy file to container with permissions", async () => {
    const source = path.resolve(fixtures, "docker", "test.txt");
    const target = "/tmp/test.txt";
    const mode = parseInt("0777", 8);

    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withCopyFilesToContainer([{ source, target, mode }])
      .withExposedPorts(8080)
      .start();

    expect((await container.exec(`stat -c "%a %n" ${target}`)).output).toContain("777");
  });

  it("should copy file to started container", async () => {
    const source = path.resolve(fixtures, "docker", "test.txt");
    const target = "/tmp/test.txt";
    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withExposedPorts(8080)
      .start();

    await container.copyFilesToContainer([{ source, target }]);

    expect((await container.exec(["cat", target])).output).toEqual(expect.stringContaining("hello world"));
  });

  it("should copy directory to container", async () => {
    const source = path.resolve(fixtures, "docker");
    const target = "/tmp";

    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withCopyDirectoriesToContainer([{ source, target }])
      .withExposedPorts(8080)
      .start();

    expect((await container.exec("cat /tmp/test.txt")).output).toEqual(expect.stringContaining("hello world"));
  });

  it("should copy directory to container with permissions", async () => {
    const source = path.resolve(fixtures, "docker");
    const target = "/tmp/newdir";
    const mode = parseInt("0777", 8);

    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withCopyDirectoriesToContainer([{ source, target, mode }])
      .withExposedPorts(8080)
      .start();

    expect((await container.exec(`stat -c "%a %n" /tmp/newdir/test.txt`)).output).toContain("777");
  });

  it("should copy directory to started container", async () => {
    const source = path.resolve(fixtures, "docker");
    const target = "/tmp";
    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withExposedPorts(8080)
      .start();

    await container.copyDirectoriesToContainer([{ source, target }]);

    expect((await container.exec("cat /tmp/test.txt")).output).toEqual(expect.stringContaining("hello world"));
  });

  it("should copy content to container", async () => {
    const content = "hello world";
    const target = "/tmp/test.txt";

    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withCopyContentToContainer([{ content, target }])
      .withExposedPorts(8080)
      .start();

    expect((await container.exec(["cat", target])).output).toEqual(expect.stringContaining(content));
  });

  it("should copy content to container with permissions", async () => {
    const content = "hello world";
    const target = "/tmp/test.txt";
    const mode = parseInt("0777", 8);

    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withCopyContentToContainer([{ content, target, mode }])
      .withExposedPorts(8080)
      .start();

    expect((await container.exec(`stat -c "%a %n" ${target}`)).output).toContain("777");
  });

  it("should copy content to started container", async () => {
    const content = "hello world";
    const target = "/tmp/test.txt";
    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withExposedPorts(8080)
      .start();

    await container.copyContentToContainer([{ content, target }]);

    expect((await container.exec(["cat", target])).output).toEqual(expect.stringContaining(content));
  });

  it("should honour .dockerignore file", async () => {
    const context = path.resolve(fixtures, "docker-with-dockerignore");
    const container = await GenericContainer.fromDockerfile(context).build();
    await using startedContainer = await container.withExposedPorts(8080).start();

    const { output } = await startedContainer.exec(["find"]);

    expect(output).toContain("exist1.txt");
    expect(output).toContain("exist2.txt");
    expect(output).toContain("exist7.txt");
    expect(output).not.toContain("example1.txt");
    expect(output).not.toContain("example2.txt");
    expect(output).not.toContain("example3.txt");
    expect(output).not.toContain("example4.txt");
    expect(output).not.toContain("example5.txt");
    expect(output).not.toContain("example6.txt");
    expect(output).not.toContain("example7.txt");
    expect(output).not.toContain("Dockerfile");
  });

  it("should stop the container", async () => {
    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withName(`container-${new RandomUuid().nextUuid()}`)
      .start();

    expect(await getRunningContainerNames()).not.toContain(container.getName());
  });

  it("should stop the container idempotently", async () => {
    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withName(`container-${new RandomUuid().nextUuid()}`)
      .start();

    const stopContainerPromises = Promise.all(
      Array(5)
        .fill(0)
        .map(() => container.stop())
    );

    await expect(stopContainerPromises).resolves.not.toThrow();
    expect(await getRunningContainerNames()).not.toContain(container.getName());
  });

  it("should stop but not remove the container", async () => {
    const container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withName(`container-${new RandomUuid().nextUuid()}`)
      .withAutoRemove(false)
      .start();

    const stopped = await container.stop();
    const dockerode = (await getContainerRuntimeClient()).container.dockerode;
    expect(stopped.getId()).toBeTruthy();
    const lowerLevelContainer = dockerode.getContainer(stopped.getId());
    expect((await lowerLevelContainer.inspect()).State.Status).toEqual("exited");
  });

  it("should stop and override .withAutoRemove", async () => {
    const container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withName(`container-${new RandomUuid().nextUuid()}`)
      .withAutoRemove(false)
      .start();

    await container.stop({ remove: true });

    const stopped = await container.stop();
    const dockerode = (await getContainerRuntimeClient()).container.dockerode;
    expect(stopped.getId()).toBeTruthy();
    const lowerLevelContainer = dockerode.getContainer(stopped.getId());
    await expect(lowerLevelContainer.inspect()).rejects.toThrow(/404/); // Error: (HTTP code 404) no such container
  });

  it("should build a target stage", async () => {
    const context = path.resolve(fixtures, "docker-multi-stage");
    const firstContainer = await GenericContainer.fromDockerfile(context).withTarget("first").build();
    const secondContainer = await GenericContainer.fromDockerfile(context).withTarget("second").build();

    await using firstStartedContainer = await firstContainer.start();
    await using secondStartedContainer = await secondContainer.start();

    expect(firstStartedContainer.getLabels().stage).toEqual("first");
    expect(secondStartedContainer.getLabels().stage).toEqual("second");
  });

  it("should set the hostname", async () => {
    await using container = await new GenericContainer("cristianrgreco/testcontainer:1.1.14")
      .withHostname("hostname")
      .start();

    expect(container.getHostname()).toEqual("hostname");
  });

  // failing to build an image hangs within the DockerImageClient.build method,
  // that change might be larger so leave it out of this commit but skip the failing test
  it.skip("should throw an error for a target stage that does not exist", async () => {
    const context = path.resolve(fixtures, "docker-multi-stage");
    await GenericContainer.fromDockerfile(context).withTarget("invalid").build();
  });
});
