import net from "net";
import { HostIp } from "../container-runtime";
import { HostPortBindings, InspectResult } from "../types";
import { getContainerPort, getProtocol, PortWithOptionalBinding } from "./port";

export class BoundPorts {
  private readonly ports = new Map<string, number>();

  public getBinding(port: number | string, protocol: string = "tcp"): number {
    const normalizedProtocol = protocol.toLowerCase();
    const key = typeof port === "string" ? port : `${port}/${normalizedProtocol}`;
    let binding = this.ports.get(key);

    // Try case-insensitive lookup if not found and port is a string that might contain a protocol
    if (!binding && typeof port === "string" && port.includes("/")) {
      const [portNumber, portProtocol] = port.split("/");
      const normalizedKey = `${portNumber}/${portProtocol.toLowerCase()}`;
      binding = this.ports.get(normalizedKey);
    }

    if (!binding) {
      throw new Error(`No port binding found for :${key}`);
    }

    return binding;
  }

  public getFirstBinding(): number {
    const firstBinding = this.ports.values().next().value;

    if (!firstBinding) {
      throw new Error("No port bindings found");
    } else {
      return firstBinding;
    }
  }

  public setBinding(key: string | number, value: number, protocol: string = "tcp"): void {
    // Normalize protocol to lowercase for consistency
    const normalizedProtocol = protocol.toLowerCase();

    if (typeof key === "string" && key.includes("/")) {
      // If key contains protocol, normalize it
      const [portNumber, portProtocol] = key.split("/");
      const normalizedKey = `${portNumber}/${portProtocol.toLowerCase()}`;
      this.ports.set(normalizedKey, value);
    } else {
      // Otherwise use the provided key/protocol
      const portKey = typeof key === "string" ? key : `${key}/${normalizedProtocol}`;
      this.ports.set(portKey, value);
    }
  }

  public iterator(): Iterable<[string, number]> {
    return this.ports;
  }

  public filter(ports: PortWithOptionalBinding[]): BoundPorts {
    const boundPorts = new BoundPorts();

    // Create map of port to protocol for lookup
    const containerPortsWithProtocol = new Map<number, string>();
    ports.forEach((port) => {
      const containerPort = getContainerPort(port);
      const protocol = getProtocol(port);
      containerPortsWithProtocol.set(containerPort, protocol);
    });

    for (const [internalPortWithProtocol, hostPort] of this.iterator()) {
      const [internalPortStr, protocol] = internalPortWithProtocol.split("/");
      const internalPort = parseInt(internalPortStr, 10);

      // Case-insensitive protocol comparison
      if (
        containerPortsWithProtocol.has(internalPort) &&
        containerPortsWithProtocol.get(internalPort)?.toLowerCase() === protocol?.toLowerCase()
      ) {
        boundPorts.setBinding(internalPortWithProtocol, hostPort);
      }
    }

    return boundPorts;
  }

  public static fromInspectResult(hostIps: HostIp[], inspectResult: InspectResult): BoundPorts {
    const boundPorts = new BoundPorts();

    Object.entries(inspectResult.ports).forEach(([containerPortWithProtocol, hostBindings]) => {
      const hostPort = resolveHostPortBinding(hostIps, hostBindings);
      boundPorts.setBinding(containerPortWithProtocol, hostPort);
    });

    return boundPorts;
  }
}

export const resolveHostPortBinding = (hostIps: HostIp[], hostPortBindings: HostPortBindings): number => {
  if (isDualStackIp(hostPortBindings)) {
    return hostPortBindings[0].hostPort;
  }

  for (const { family } of hostIps) {
    const hostPortBinding = hostPortBindings.find(({ hostIp }) => net.isIP(hostIp) === family);
    if (hostPortBinding !== undefined) {
      return hostPortBinding.hostPort;
    }
  }
  throw new Error("No host port found for host IP");
};

const isDualStackIp = (hostPortBindings: HostPortBindings): boolean =>
  hostPortBindings.length === 1 && hostPortBindings[0].hostIp === "";
