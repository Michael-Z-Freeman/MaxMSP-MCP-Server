autowatch = 1;

const Max = require("max-api");
const { Server } = require("socket.io");

// Configuration
var PORT = 5002;
const NAMESPACE = "/mcp";

// Console error capture
var console_errors = [];
var max_error_history = 100;

// Create Socket.IO server
var io = new Server(PORT, {
  cors: { origin: "*" }
});

Max.outlet("port", `Server listening on port ${PORT}`);

// Console error capture functions
function capture_console_error(error_msg) {
    var timestamp = new Date().toISOString();
    var error_entry = {
        timestamp: timestamp,
        message: error_msg,
        source: "max_node_console"
    };

    console_errors.push(error_entry);

    if (console_errors.length > max_error_history) {
        console_errors.shift();
    }

    // Emit error to connected MCP clients
    io.of(NAMESPACE).emit("console_error", error_entry);
}

// Override console.error to capture errors
var original_console_error = console.error;
console.error = function(...args) {
    var error_msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
    capture_console_error(error_msg);
    original_console_error.apply(console, args);
};

// Monitor Max.post for error patterns
var original_max_post = Max.post;
Max.post = function(msg) {
    // Capture messages that contain error indicators
    if (typeof msg === 'string' &&
        (msg.includes('error') || msg.includes('Error') ||
         msg.includes('connecting outlet') || msg.includes('inlet'))) {
        capture_console_error(msg);
    }
    original_max_post.call(Max, msg);
};

function safe_parse_json(str) {
    try {
        return JSON.parse(str);
    } catch (e) {
        Max.post("error, Invalid JSON: " + e.message);
        Max.post("This is likely because the patcher has too much objects, select some of them and try again");
        return null;
    }
}

Max.addHandler("response", async (...msg) => {
	var str = msg.join("")
	var data = safe_parse_json(str);
	await io.of(NAMESPACE).emit("response", data);
	// await Max.post(`Sent response: ${JSON.stringify(data)}`);
});

Max.addHandler("port", async (msg) => {
  Max.post(`msg ${msg}`);
  if (msg > 0 && msg < 65536) {
    PORT = msg;
  }
  await io.close();
  io = new Server(PORT, {
    cors: { origin: "*" }
  });
  // await Max.post(`Socket.IO MCP server listening on port ${PORT}`);
  await Max.outlet("port", `Server listening on port ${PORT}`);
});

io.of(NAMESPACE).on("connection", (socket) => {
  Max.post(`Socket.IO client connected: ${socket.id}`);

  socket.on("command", async (data) => {
    // Max.post(`Socket.IO command received: ${data}`);
	  Max.outlet("command", JSON.stringify(data)); 
  });

  socket.on("request", async (data) => {
	  Max.outlet("request", JSON.stringify(data)); 
  });

  socket.on("port", async (data) => {
    Max.post(`msg ${data}`);
    if (data > 0 && data < 65536) {
      PORT = data;
    }
    await io.close();
    io = new Server(PORT, {
      cors: { origin: "*" }
    });
    // await Max.post(`Socket.IO MCP server listening on port ${PORT}`);
    await Max.outlet("port", `Server listening on port ${PORT}`);
  });
  

  socket.on("get_console_errors", async (data) => {
    Max.post(`MCP REQUEST: get_console_errors`);
    var response = {
      request_id: data.request_id || "unknown",
      results: {
        errors: console_errors,
        count: console_errors.length
      }
    };
    socket.emit("response", response);
  });

  socket.on("clear_console_errors", async (data) => {
    Max.post(`MCP COMMAND: clear_console_errors`);
    console_errors = [];
    Max.post("Console errors cleared");
  });

  socket.on("disconnect", () => {
    Max.post(`Socket.IO client disconnected: ${socket.id}`);
  });
});
