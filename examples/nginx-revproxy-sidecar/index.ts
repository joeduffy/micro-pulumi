import * as micro from "../../lib";
import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();

// Create a new cluster to run our microservices.
const cluster = new micro.AwsEcsCluster("my-cluster");

// Build and publish the ./app/Dockerfile image, and run a microservice.
const application = new micro.Service(cluster, {
    name: "my-app",
    image: "./app",
    replicas: config.getNumber("replicas"),
    sidecars: [
        {
            name: "nginx-rp",
            image: "./nginx",
            ports: [ 80 ],
        },
    ],
});

// Export the resulting load balanced URL.
export const urls = application.endpoints;
