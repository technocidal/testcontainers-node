import { ContainerInspectInfo } from "dockerode";
import { IntervalRetry, log } from "../common";
import { InspectResult } from "../types";
import { mapInspectResult } from "../utils/map-inspect-result";
import { getContainerPort, getProtocol, PortWithOptionalBinding } from "../utils/port";

type Result = {
  inspectResult: ContainerInspectInfo;
  mappedInspectResult: InspectResult;
};

export async function inspectContainerUntilPortsExposed(
  inspectFn: () => Promise<ContainerInspectInfo>,
  ports: PortWithOptionalBinding[],
  containerId: string,
  timeout = 10_000
): Promise<Result> {
  const result = await new IntervalRetry<Result, Error>(250).retryUntil(
    async () => {
      const inspectResult = await inspectFn();
      const mappedInspectResult = mapInspectResult(inspectResult);
      return { inspectResult, mappedInspectResult };
    },
    ({ mappedInspectResult }) =>
      ports.every((exposedPort) => {
        const containerPort = getContainerPort(exposedPort);
        const protocol = getProtocol(exposedPort);
        const portKey = `${containerPort}/${protocol}`;
        return mappedInspectResult.ports[portKey]?.length > 0;
      }),
    () => {
      const message = `Container did not expose all ports after starting`;
      log.error(message, { containerId });
      return new Error(message);
    },
    timeout
  );

  if (result instanceof Error) {
    throw result;
  }

  return result;
}
