require('MeshAgent').AddCommandHandler(handleServerCommand);

/*
Copyright 2019 Intel Corporation

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

require('MeshAgent').on('Connected', function (status)
{
    if (status == 0)
    {
        return;
    }
    this.timeout = setTimeout(start, 10000);
});



function sendServerLog(msg)
{
    require('MeshAgent').SendCommand({ action: 'diagnostic', value: { command: 'log', value: msg } });
}

function sendConsoleText(msg, sessionid)
{
    var cmd = { action: 'msg', type: 'console', value: msg };
    if (sessionid != null) { cmd.sessionid = sessionid; }
    require('MeshAgent').SendCommand(cmd);
}

function splitArgs(str)
{
    var ret = [];
    var token = '';
    var inQuote = false;
    var quoteChar = null;
    var escaped = false;
    if (str == null) { return ret; }
    for (var i = 0; i < str.length; ++i)
    {
        var c = str.charAt(i);
        if (escaped) { token += c; escaped = false; continue; }
        if (inQuote)
        {
            if (c == '\\') { escaped = true; continue; }
            if (c == quoteChar) { inQuote = false; quoteChar = null; continue; }
            token += c;
            continue;
        }
        if (c == '"' || c == '\'') { inQuote = true; quoteChar = c; continue; }
        if (c <= ' ')
        {
            if (token.length > 0) { ret.push(token); token = ''; }
            continue;
        }
        token += c;
    }
    if (escaped) { token += '\\'; }
    if (token.length > 0) { ret.push(token); }
    return ret;
}

function toNumberIfNumber(x) { if ((typeof x == 'string') && x.length > 0 && /^-?\d+(\.\d+)?$/.test(x)) { x = +x; } return x; }

function parseArgs(argv)
{
    var results = { '_': [] }, current = null;
    for (var i = 1, len = argv.length; i < len; i++)
    {
        var x = argv[i];
        if (x.length > 2 && x[0] == '-' && x[1] == '-')
        {
            if (current != null) { results[current] = true; }
            current = x.substring(2);
        }
        else
        {
            if (current != null) { results[current] = toNumberIfNumber(x); current = null; } else { results['_'].push(toNumberIfNumber(x)); }
        }
    }
    if (current != null) { results[current] = true; }
    return results;
}

function processConsoleCommand(cmd, args, rights, sessionid)
{
    var response = null;
    try
    {
        switch (cmd)
        {
            case 'help':
                response = 'Available commands are: umhctl.';
                break;
            case 'umhctl':
                response = require('umhctl').consoleaction(args, rights, sessionid, null);
                break;
            default:
                response = 'Unknown command "' + cmd + '", type "help" for list of available commands.';
                break;
        }
    }
    catch (ex)
    {
        response = 'umhctl unavailable: ' + ex;
    }
    if (response != null) { sendConsoleText(response, sessionid); }
}

function handleServerCommand(data)
{
    if ((typeof data == 'object') && (data.action == 'msg') && (data.type == 'console') && data.value && data.sessionid)
    {
        try
        {
            var args = splitArgs(data.value);
            if (args.length > 0) { processConsoleCommand(args[0].toLowerCase(), parseArgs(args), data.rights, data.sessionid); }
        }
        catch (ex)
        {
            sendConsoleText('umhctl unavailable: ' + ex, data.sessionid);
        }
    }
}
function getMeshAgentService()
{
    try
    {
        var ret = require('service-manager').manager.getService(process.platform == 'win32' ? 'mesh agent' : 'meshagent');
        return(ret);
    }
    catch(e)
    {
        return (null);
    }
}

function getARCHID() {
    var ret = 0;
    switch (process.platform) {
        case 'linux':
            // Need to detect Architecture ID
            var child = require('child_process').execFile('/bin/sh', ['sh']);
            child.stdout.str = '';
            child.stdout.on('data', function (chunk) { this.str += chunk.toString(); });
            child.stdin.write("uname -m\nexit\n");
            child.waitExit();
            switch (child.stdout.str.trim()) {
                case 'x86_64':
                case 'amd64':
                    ret = 6;
                    break;
                case 'x86':
                case 'i686':
                case 'i586':
                case 'i386':
                    ret = 5;
                    break;
                case 'armv6l':
                case 'armv7l':
                    ret = 25;
                    break;
                default:
                    break;
            }
            break;
        case 'darwin':
            ret = 16;
            break;
        case 'win32':
            ret = process.arch == 'x64' ? 4 : 3;
            break;
    }
    return (ret);
}

function DownloadAgentBinary(path, ID)
{
    var options = require('http').parseUri(require('MeshAgent').ServerInfo.ServerUri);
    var downloadUri = 'https://' + options.host + ':' + options.port + '/meshagents?id=' + (ID != null ? ID : getARCHID());
    sendServerLog('Diagnostic: Attempting to downlod agent from: ' + downloadUri);

    return (wget(downloadUri, path, { rejectUnauthorized: false }));
}

function giveup()
{
    sendServerLog('Diagnostic: Unable to diagnose Mesh Agent');
    finished();
}
function finished()
{
    sendServerLog('Diagnostic: End');
    require('service-manager').manager.getService('meshagentDiagnostic').stop();
}

function ConfigureAgent(agent)
{
    sendServerLog('...Configuring Agent...');
    var info = require('MeshAgent').ServerInfo;

    var msh = 'MeshID=0x' + info.MeshID + '\n' + 'ServerID=' + info.ServerID + '\n' + 'MeshServer=' + info.ServerUri + '\n';
    var cfg = require('global-tunnel').proxyConfig;
    if(cfg == null)
    {
        msh += 'ignoreProxyFile=1\n';
    }
    else
    {
        msh += ('WebProxy=' + cfg.host + ':' + cfg.port + '\n');
    }
    if(process.platform == 'win32')
    {
        require('fs').writeFileSync(agent.appLocation().replace('.exe', '.msh'), msh);
    }
    else
    {
        require('fs').writeFileSync(agent.appLocation() + '.msh', msh);
    }
}

function start()
{
    sendServerLog('Diagnostic: Start');

    var id = getARCHID();
    var s = getMeshAgentService();
    if (s == null)
    {
        DownloadAgentBinary('agent_temporary.bin').then(function ()
        {
            // SUCCESS
            try
            {
                var agent = require('service-manager').manager.installService(
                    {
                        name: process.platform == 'win32' ? 'Mesh Agent' : 'meshagent',
                        target: 'meshagent',
                        description: 'Mesh Central Agent v2 Background Service',
                        displayName: 'Mesh Agent v2 Background Service',
                        servicePath: 'agent_temporary.bin',
                        startType: 'DEMAND_START'
                    });
                require('fs').unlinkSync('agent_temporary.bin');
                ConfigureAgent(agent);
            }
            catch(e)
            {
                giveup();
            }
        },
        function ()
        {
            // FAILURE
            giveup();
        });
    }
    if(s!=null)
    {
        // Mesh Agent Installation Found
        sendServerLog('Diagnostic: Mesh Agent Service => ' + (s.isRunning() ? 'RUNNING' : 'NOT-RUNNING'));
        if(s.isRunning())
        {
            finished();
        }
        else
        {
            sendServerLog('Diagnostic: Attempting to start Mesh Agent');
            s.start();
            sendServerLog('Diagnostic: ' + (s.isRunning() ? '(SUCCESS)' : '(FAILED)'));
            if (s.isRunning())
            {
                finished();
                return;
            }
            else
            {
                DownloadAgentBinary(s.appLocation()).then(
                    function () {
                        sendServerLog('Diagnostic: Downloaded Successfully');
                        sendServerLog('Diagnostic: Attempting to start Mesh Agent');
                        s.start();
                        sendServerLog('Diagnostic: ' + (s.isRunning() ? '(SUCCESS)' : '(FAILED)'));
                        if (s.isRunning()) {
                            finished();
                            return;
                        }
                        else {
                            giveup();
                        }
                    },
                    function () {
                        sendServerLog('Diagnostic: Download Failed');
                        giveup();
                    });
            }
        }
    }
};
