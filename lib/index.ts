import * as awsx from "@pulumi/awsx";
import * as eks from "@pulumi/eks";
import * as kx from "@pulumi/kubernetesx";
import { ComponentResource, ComponentResourceOptions, Output } from "@pulumi/pulumi";

export class Cluster extends ComponentResource {
    public readonly kind: ClusterKind;

    constructor(name: string, kind: ClusterKind, opts?: ComponentResourceOptions) {
        super(name, `micropulu:index:${kind}Cluster`, { kind: kind }, opts);
        this.kind = kind;
    }
}

export type ClusterKind = "AwsEcs" | "Kubernetes";
export const ClusterKindAwsEcs = "AwsEcs";
export const ClusterKindKubernetes = "Kubernetes";

export class AwsEcsCluster extends Cluster {
    public readonly ecs: awsx.ecs.Cluster;

    constructor(name: string, opts?: ComponentResourceOptions) {
        super(name, ClusterKindAwsEcs, opts);
        this.ecs = new awsx.ecs.Cluster(name);
    }
}

export class Service extends ComponentResource {
    public readonly endpoints: Output<string>[];

    constructor(cluster: Cluster, args: ServiceArgs, opts?: ComponentResourceOptions) {
        super(args.name, `micropulu:index:Service`, {}, opts);

        // Based on the cluster kind, create the relevant resources.
        switch (cluster.kind) {
            case ClusterKindAwsEcs:
                this.endpoints = this.createAwsEcsService((cluster as AwsEcsCluster).ecs, args);
                break;
            case ClusterKindKubernetes:
                throw new Error(`Kubernetes clusters not yet supported`);
            default:
                throw new Error(`Unrecognized cluster kind '${cluster.kind}'`);
        }
    }

    private createAwsEcsService(cluster: awsx.ecs.Cluster, args: ServiceArgs): Output<string>[] {
        const containers: {[name: string]: awsx.ecs.Container} = {};
        const endpoints: Output<string>[] = [];

        // Build and publish the primary container image.
        const [appC, appL] = this.createAwsEcsContainer(cluster, args);
        containers[args.name] = appC;
        for (const l of appL) {
            endpoints.push(l);
        }

        // Now do the same for any sidecars to attach to the primary container image.
        for (const sidecar of args.sidecars || []) {
            const [sideC, sideL] = this.createAwsEcsContainer(cluster, sidecar);
            sideC.links = [ args.name ]; // link the sidecar
            containers[`sidecar-${sidecar.name}`] = sideC;
            for (const l of sideL) {
                endpoints.push(l);
            }
        }

        // Create the actual service itself.
        const svc = new awsx.ecs.FargateService(`${args.name}-svc`, {
            cluster,
            taskDefinitionArgs: {
                containers,
            },
            desiredCount: args.replicas || 1,
            // networkMode: args.sidecars ? "bridge" : undefined,
        }, { parent: this });

        return endpoints;
    }

    private createAwsEcsContainer(cluster: awsx.ecs.Cluster,
                                  cont: ContainerArgs): [awsx.ecs.Container, Output<string>[]] {
        let listeners: awsx.lb.ApplicationListener[] = [];
        let endpoints: Output<string>[] = [];
        if (cont.ports) {
            const alb = new awsx.lb.ApplicationLoadBalancer(
                `${cont.name}-lb`,
                { external: true, securityGroups: cluster.securityGroups },
                { parent: this },
            );
            for (const port of cont.ports) {
                const l = alb.createListener(`${cont.name}-lb-${port}`, { port, external: true });
                listeners.push(l);
                endpoints.push(l.endpoint.apply(ep => `http://${ep.hostname}:${ep.port}`));
            }
        }
        return [
            {
                image: awsx.ecs.Image.fromPath(`${cont.name}-img`, cont.image),
                portMappings: listeners,
                memory: 256,
                cpu: 256,
                essential: true,
            },
            endpoints,
        ];
    }
}

export interface ContainerArgs {
    name: string;
    image: string;
    ports?: number[];
}

export interface ServiceArgs extends ContainerArgs {
    replicas?: number;
    ports?: number[];
    sidecars?: ContainerArgs[];
}
