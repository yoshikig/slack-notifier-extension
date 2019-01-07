'use strict';

var kKeepAliveAlarmName = 'KEEPALIVE';
var kPeriodicalUpdateAlarmName = 'PERIODICAL';

var g = {};
clearGlobalValues();
Object.seal(g);

function clearGlobalValues() {
  g.token = '';
  g.teamInfo = null;
  g.iconImageElement = null;
  g.iconImageUrl = '';
  g.unreadCounts = {};
  g.mentionCounts = {};
}

function getToken() {
  return new Promise(function(resolve, reject) {
    chrome.storage.sync.get({token: ''}, (items) => {
      if (items.token) {
        g.token = items.token; 
        resolve(items.token);
      } else {
        g.token = '';
        reject('getToken failed');
      }
    });
  });
}

function send(api, args) {
  if (!g.token)
    return getToken().then(() => sendInternal(api, args));
  else
    return sendInternal(api, args);
}

function sendInternal(api, args) {
  if (!g.token)
    return Promise.reject('invalid tokens');

  args = args || {};

  var formData = new FormData;
  formData.append('token', g.token);
  for (var k in args) {
    formData.append(k, args[k]);
  }

  return fetch('https://slack.com/api/' + api, {
    method: 'post',
    body: formData
  }).then(res => {
    if(res.headers.get('content-type') !== 'application/json; charset=utf-8')
      return Promise.reject('invalid responce');

    return res.json();
  }).then(json => {
    if (!json.ok) {
      console.error(api, formData, json);
      return Promise.reject('Slack API error: ' + json.ok);
    }

    return json;
  });
}

function isUnread() {
  return new Promise(function(resolve, reject) {
    send('users.counts').then(json => {
      console.debug(json);
      g.unreadCounts = {};
      g.mentionCounts = {};
      json.channels.forEach(c => {
        if (!c.is_muted) {
          g.unreadCounts[c.id] = c.unread_count_display;
          g.mentionCounts[c.id] = c.mention_count_display;
        }
      });
      json.groups.forEach(c => {
        g.unreadCounts[c.id] = c.unread_count_display;
        g.mentionCounts[c.id] = c.mention_count_display;
      });
      json.ims.forEach(c => {
        g.mentionCounts[c.id] = c.dm_count;
      });
      resolve();
    }).catch(err => reject(err));
  });
}

function glayize(data) {
  for (var i = 0; i < data.data.length; i=i+4) {
    var pixel = (data.data[i] + data.data[i+1] + data.data[i+2]) / 3 + 128;
    data.data[i] = data.data[i+1] = data.data[i+2] = pixel;
  }
}

function getTeamInfo() {
  if (g.teamInfo)
    return Promise.resolve(g.teamInfo);

  return send('team.info').then(json => {
    g.teamInfo = json.team;
    return json.team;
  });
}

function getIconImageElement() {
  if (g.iconImageElement)
    return Promise.resolve(g.iconImageElement);

  return new Promise((resolve, reject) => {
    getTeamInfo().then(teamInfo => {
      console.log(teamInfo.icon.image_132);
      var img = document.createElement('img');
      img.src = teamInfo.icon.image_132;
      img.onload = (() => {
        g.iconImageElement = img;
        g.iconImageUrl = teamInfo.icon.image_132;
        resolve(img);
      });
      img.onerror = (() => {
        reject('Image Load Error');
      });
    });
  });
}

function setIcon(isGray) {
  return getIconImageElement().then(image => {
    var c = document.createElement('canvas');
    var ctx=c.getContext("2d");
    ctx.drawImage(image, 0, 0, 19, 19);
    var imageData = ctx.getImageData(0, 0, 19, 19);

    if (isGray)
      glayize(imageData);

    chrome.browserAction.setIcon({imageData: imageData});
  }).catch(err => console.error(err));
}

function updateUnreadCount() {
  var unreadCount = 0;
  var mentionCount = 0;
  for (var k in g.unreadCounts) {
    unreadCount += g.unreadCounts[k];
  }
  for (var k in g.mentionCounts) {
    mentionCount += g.mentionCounts[k];
  }
  setIcon(unreadCount == 0 && mentionCount == 0);
  if (mentionCount > 0) {
    chrome.browserAction.setBadgeText({text: mentionCount.toString()});
    chrome.browserAction.setBadgeBackgroundColor({color: '#d00'});
  } else if (unreadCount > 0) {
    chrome.browserAction.setBadgeText({text: unreadCount.toString()});
    chrome.browserAction.setBadgeBackgroundColor({color: '#777'});
  } else {
    chrome.browserAction.setBadgeText({text: ''});
  }
}

function update() {
  isUnread().then(()=> {
    updateUnreadCount();
  });

  chrome.alarms.create(kPeriodicalUpdateAlarmName, { delayInMinutes: 1 });
}

chrome.alarms.onAlarm.addListener(alarm => {
  switch (alarm.name) {
    case kKeepAliveAlarmName:
      startKeepAlive();
      break;
    case kPeriodicalUpdateAlarmName:
      update();
      break;
  }
});

chrome.runtime.onStartup.addListener(function() {
  update();
  startWebSocket();
});

function startWebSocket() {
  send('rtm.start').then(json => {
    var socket = new WebSocket(json.url);
    socket.onopen = ((e) => {
      startKeepAlive();
    });
    socket.onmessage = ((e) => {
      var json = null;
      try {
        json = JSON.parse(e.data);
      } catch(e) {
      }
      if (!json)
        return;

      if (json.type === 'channel_marked' || json.type === 'group_marked') {
        console.log(json);
        g.unreadCounts[json.channel] = json.unread_count_display;
        g.mentionCounts[json.channel] = json.mention_count_display;
        updateUnreadCount();
      } else if (json.type === 'im_marked') {
        console.log(json);
        g.mentionCounts[json.channel] = json.dm_count;
        updateUnreadCount();
      } else if (json.type === 'presence_change') {
      } else if (json.type === 'reconnect_url') {
      } else if (json.type === 'desktop_notification') {
        //chrome.notifications.create("ID", {type: 'basic', iconUrl: json.avaterImage, title: json.title, message: json.content + " "});
        new Notification(json.title, {icon: json.avaterImage, badge: g.iconImageUrl, body: json.content + " "}); 
        console.log(json);
      } else {
        console.log(json);
      }
    });
    socket.onerror = ((e) => {
      console.info('websocket error');
    });
    socket.onclose = ((e) => {
      console.info('websocket close');
      startWebSocket();
    });
  });
}

chrome.runtime.onInstalled.addListener(function() {
  update();
  startWebSocket();
});

function startKeepAlive() {
  var port = chrome.runtime.connect({name: "knockknock"});
  console.log('aa');
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName != 'sync')
    return;

  if (changes.token && changes.token.newValue != g.token) {
    clearGlobalValues();
    update();
  }
});

chrome.browserAction.onClicked.addListener(() => {
  getTeamInfo().then(teamInfo => {
    var url = 'https://' + teamInfo.domain + '.slack.com/';
    var pattern = url + '*';
    chrome.tabs.query({currentWindow: true, url: pattern}, (tabs) => {
      for (var i in tabs) {
        var tab = tabs[i];
        if ((typeof tab.url == 'string') && tab.url.startsWith(url)) {
          chrome.tabs.update(tab.id, {active: true});
          return;
        }
      }
      chrome.tabs.create({ url: url }, () => {});
    });
  });
});

chrome.runtime.onSuspend.addListener(() => {
  console.log('s');
  chrome.runtime.getBackgroundPage(() => {});
});

chrome.runtime.onSuspendCanceled.addListener(() => {
  console.log('c');
});
