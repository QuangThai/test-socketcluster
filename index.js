import socketClusterClient from "socketcluster-client";
// import SHA256 from "crypto-js/sha256";
// import Base64 from "crypto-js/enc-base64";

// eslint-disable-next-line no-void
export const muted = () => void 0;

export const debugFactory = (debugMode = true) => ({
  debug: debugMode ? console.log : muted,
  debugBeginGroup: debugMode ? console.groupCollapsed : muted,
  debugEndGroup: debugMode ? console.groupEnd : muted,
});

const REPORT_CLIENT_ERROR_EVENT = "report_client_error";
const DEFAULT_SOCKET_PATH = "/realtime/";
const LOGS_TRACKING_EVENT = "log_tracking";
const FEEDS_TRACKING_EVENT = "feed_tracking";
const USER_AGENT_TRACKING = "event_logout_by_user_agent";
const BOX_COIN_TRACKING = "event_join_game_hahalolo";
const CLICKED_BOX_COIN_TRACKING = "event_receive_coin_feed";
const LOGGER_ERROR_SLACK = "event_logger_error_slack";
const COMMENT_POST_TRACKING = "comment_post_tracking";
const REACTION_POST_TRACKING = "reaction_post_tracking";

let socket;

let { debug, debugBeginGroup, debugEndGroup } = debugFactory();

const privateChannels = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isObject = (o) => typeof o === "object" && o !== null;

const isConnected = () => {
  return socket && socket.state === socket.OPEN;
};

const isAuthenticated = () =>
  isConnected() && socket.authState === socket.AUTHENTICATED;

const reportClientError = (e) => {
  // const name = e.message + ', ' + e.filename + ', ' + e.lineno + ':' + e.colno;
  const name = e.message;
  let stacktrace = e.stack;
  if (!stacktrace && e.error) {
    stacktrace = e.error.stack;
  }

  if (stacktrace && socket) {
    debug("[Error Reporting]", REPORT_CLIENT_ERROR_EVENT, {
      name,
      stacktrace,
    });

    socket.transmit(REPORT_CLIENT_ERROR_EVENT, {
      name,
      stacktrace,
    });
  }
};

const connect = async (options) => {
  const { enableErrorReporting } = options;
  if (!options.debug) {
    // eslint-disable-next-line no-multi-assign
    debug = debugBeginGroup = debugEndGroup = muted;
  }

  delete options.debug;
  delete options.enableErrorReporting;

  if (!socket) {
    const DEFAULT_OPTIONS = {
      path: DEFAULT_SOCKET_PATH,
    };

    options = isObject(options)
      ? Object.assign({}, DEFAULT_OPTIONS, options)
      : DEFAULT_OPTIONS;

    debug("[Socket] Initiate new connection to the server");
    socket = socketClusterClient.create(options);
    const connection = await socket.listener("connect").once();
    if (!connection.authError) {
      if (connection.authError?.isBadToken) {
        socket.disconnect();
      }
    } else {
      debug("[Socket] Connected to the server successfully", connection);
    }

    if (enableErrorReporting) {
      debug("[Socket Service] Error Reporting");
      // window.addEventListener("error", reportClientError);
    }
  }
  return socket;
};

const disconnect = () => {
  socket.disconnect();
};

const logout = async () => {
  if (isConnected()) {
    debug(`[Socket] Logout`);
    // Xoá authToken khỏi socket, tránh trường hợp đăng nhập tài khoản khác mà dùng socket của tài khoản cũ
    await socket.deauthenticate();
  }
  return true;
};

const login = async (userId, checksum) => {
  if (!isConnected()) {
    debug("Socket :: Not connected");
    return false;
  }

  if (isAuthenticated()) {
    if (await isLoggedAs(userId)) {
      debug("Socket :: You have logged in before.");
      return true;
    }
    debug(
      "Socket :: Current Authenticated is not belong to you. So you will be logged out before logging back in"
    );
    await logout();
  }

  // Gọi RPC login

  const rpcLogin = await socket.invoke("login", {
    userId,
    checksum,
    "user-agent":
      "Simulator iPhone12,1/15.5/B70AD3BE-CFE1-43AF-BA41-BBAE384F8DF0",
  });
  return rpcLogin;
};

const isLoggedAs = async (userId) => {
  await sleep(20);
  //   console.log(socket);
  if (userId && isAuthenticated()) {
    const authToken = socket.getAuthToken();
    if (authToken) {
      const { userId: socketUserId, exp } = authToken;
      const now = Math.floor((Date.now() || +new Date()) / 1000);
      return userId === socketUserId && exp > now;
    }
  }

  return false;
};

/**
 * [RPC]
 */

const eTypeEventTracking = {
  noti: LOGS_TRACKING_EVENT,
  feed: FEEDS_TRACKING_EVENT,
  boxCoin: BOX_COIN_TRACKING,
  userAgent: USER_AGENT_TRACKING,
  clickedCoin: CLICKED_BOX_COIN_TRACKING,
  loggerError: LOGGER_ERROR_SLACK,
  commentPost: COMMENT_POST_TRACKING,
  reactionPost: REACTION_POST_TRACKING,
};

const eventRPC = async (params, typeSocket) => {
  try {
    // Gọi RPC login
    await socket.invoke(eTypeEventTracking[typeSocket], params);
  } catch (error) {
    console.log("error", error);
  }
};

const subscribeChannel = (channelName, callback, isPrivate = false) => {
  if (!isConnected()) {
    debug(
      "[Socket] Socket is not created or open, so cannot subscribe channel",
      channelName
    );
    return null;
  }
  if (isPrivate) {
    if (!privateChannels.includes(channelName)) {
      privateChannels.push(channelName);
    }
    debug("[Socket] Private Channels:", privateChannels);
    if (!isAuthenticated()) {
      debug(
        "[Socket] Socket is not authenticated, so cannot subscribe private channel",
        channelName
      );
      return null;
    }
  }
  const channel = socket.channel(channelName);
  debugBeginGroup(`Subscribe channel ${channelName}`);
  if (channel.state !== channel.SUBSCRIBED) {
    channel.subscribe({
      waitForAuth: !!isPrivate,
    });

    debug(`Channel ${channelName} has subscribed`);

    if (callback) {
      debug(`Channel ${channelName} is consuming`);
      (async () => {
        await channel.listener("subscribe").once();
        // eslint-disable-next-line no-restricted-syntax
        for await (const data of channel) {
          callback(data);
        }
      })();
    }
  } else {
    debug(`Channel ${channelName} has subscribed before`);
  }

  debugEndGroup();

  return channel;
};

const subscribePrivateChannel = (channelName, callback) =>
  subscribeChannel(channelName, callback, true);

const unsubscribeChannel = (channelName) => {
  if (socket && channelName) {
    socket.unsubscribe(channelName);
    debug(`[Socket] Channel ${channelName} has unsubscribed`);
  }
};

const unsubscribeAllPrivateChannels = () => {
  if (privateChannels && privateChannels.length > 0) {
    debug(`[Socket] Unsubscribe private channels:`, privateChannels);
    privateChannels.forEach(unsubscribeChannel);
  }
};

// lắng nghe sự kiện user click
const transmitData = (params, type = "noti") => {
  socket.transmit(eTypeEventTracking[type], params);
};

const getPrivateChannels = () => privateChannels;

const logSocket = () => console.log("SOCKET", socket);

const CHECKSUM_SECRET = "C0v1d-19";

const callApiGetSocketTokenForLogin = async (userId) => {
  if (!userId) return null;
  try {
    return {
      userId,
      checksum: SHA256(userId + CHECKSUM_SECRET + navigator.userAgent).toString(
        Base64
      ),
    };
  } catch (e) {
    console.log("ÊEEEEEE", e);
  }
};

const options = {
  hostname: "localhost",
  port: 8000,
  secure: false,
  // hostname: process.env.HOST_NAME,
  // port: process.env.PORT,
  // secure: true,
  debug: process.env.DEBUG,
  enableErrorReporting: true,
};

const connectSocket = async () => {
  const socket = await connect(options);
  return {
    ...socket,
    login,
    isConnected,
  };
};

(async () => {
  try {
    const socket = await connectSocket();
    console.log(socket.isConnected());
    if (socket.isConnected()) {

      const result = await socket.login(
        "5f8fbbedbc502609c220f8c9",
        "alFu/ts6GY4PlGv0Yn2uCBtf9O5QZUCN0fpiio48ZWE="
      );
      console.log("loginRPC", result);
    }
  } catch (error) {
    console.log("error", error);
  }
})();
