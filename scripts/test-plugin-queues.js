"use strict";

/**
 * Lightweight regression test for the per-node job queues implemented in the
 * manualmap, swdabypass, and bypassmethods plugins. We simulate a MeshAgent
 * telling us it is busy, verify that we retry with the same job object, and
 * confirm that the queued follow-up job only runs after the first job finishes.
 *
 * Execute with: `node scripts/test-plugin-queues.js`
 */

const assert = require("assert");

function buildPlugin(factory, pluginName) {
    const sentEvents = [];
    const sentMessages = [];
    let currentAgentResponse = null;

    const fakeAgent = {
        dbNodeName: "Queue Tester",
        send: (payload) => {
            const parsed = JSON.parse(payload);
            sentMessages.push({ ...parsed, pluginName });
            currentAgentResponse = parsed.responseid;
        }
    };

    const fakeMeshServer = {
        config: {
            domains: {
                "": { Title: "Local MeshCentral Dev" }
            }
        },
        DispatchEvent: (targets, plugin, event) => {
            sentEvents.push({ targets, plugin: pluginName, event });
        },
        parent: null,
        webserver: {
            wsagents: { "node//1": fakeAgent },
            args: { aliasport: 8443 },
            getWebServerName: () => "127.0.0.1"
        }
    };
    fakeMeshServer.parent = fakeMeshServer;

    const plugin = factory({ parent: fakeMeshServer });
    plugin.retryDelayMs = 25;
    plugin.jobTimeoutMs = 500;

    return {
        plugin,
        fakeAgent,
        sentEvents,
        sentMessages,
        getCurrentResponseId: () => currentAgentResponse
    };
}

async function runQueueScenario(factory, pluginName) {
    const { plugin, sentEvents, sentMessages, getCurrentResponseId } = buildPlugin(factory, pluginName);
    const nodeid = "node//1";
    const userid = "user//1";

    // Prime queue with a running job
    plugin.enqueueRunCommand({
        nodeid,
        userid,
        action: "deploy",
        script: [{ type: "ps", value: "Write-Host 'deploy1'" }],
        runAsUser: 0
    });

    assert.strictEqual(sentMessages.length, 1, `${pluginName}: expected initial dispatch`);
    const firstResponse = getCurrentResponseId();
    assert.ok(firstResponse, `${pluginName}: missing response id on first dispatch`);

    // Queue up a second job which should wait
    plugin.enqueueRunCommand({
        nodeid,
        userid,
        action: "undeploy",
        script: [{ type: "ps", value: "Write-Host 'undeploy1'" }],
        runAsUser: 0
    });

    assert.strictEqual(sentMessages.length, 1, `${pluginName}: second job dispatched too early`);
    assert.ok(sentEvents.some(e => e.event.details.status.startsWith("Queued")), `${pluginName}: missing queued status event`);

    // Simulate a busy response from agent
    plugin.hook_processAgentData({
        responseid: firstResponse,
        action: "msg",
        type: "runcommands",
        result: "Agent already busy"
    });

    await new Promise((resolve) => setTimeout(resolve, plugin.retryDelayMs * 3));

    assert.strictEqual(sentMessages.length, 2, `${pluginName}: retry dispatch missing`);
    const secondResponse = getCurrentResponseId();
    assert.ok(secondResponse && secondResponse !== firstResponse, `${pluginName}: retry did not get a new response id`);

    // Final success response should release queue and trigger job 2
    plugin.hook_processAgentData({
        responseid: secondResponse,
        action: "msg",
        type: "runcommands",
        result: "Command completed."
    });

    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.strictEqual(sentMessages.length, 3, `${pluginName}: queued job did not dispatch after success`);
    const third = sentMessages[2];
    assert.strictEqual(third.cmds[0].value.includes("undeploy1"), true, `${pluginName}: queued job payload mismatch`);
}

async function main() {
    await runQueueScenario(require("../meshcentral-data/plugins/manualmap/manualmap.js").manualmap, "manualmap");
    await runQueueScenario(require("../meshcentral-data/plugins/swdabypass/swdabypass.js").swdabypass, "swdabypass");
    await runQueueScenario(require("../meshcentral-data/plugins/bypassmethods/bypassmethods.js").bypassmethods, "bypassmethods");
    console.log("Plugin queue regression test passed.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
