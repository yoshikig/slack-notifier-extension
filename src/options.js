'use strict';

var saveCount = 0;

function save_options() {
  var token = document.getElementById('token').value;
  chrome.storage.sync.set({
    token: token
  }, () => {
    document.getElementById('status').innerText = 'saved';
    saveCount++;
    setTimeout(((targetSaveCount) => {
      if(saveCount === targetSaveCount)
        document.getElementById('status').innerText = '';
    }).bind(null, saveCount), 1000);
  });
}

function restore_options() {
  chrome.storage.sync.get({
    token: ''
  }, (items) => {
    document.getElementById('token').value = items.token;
  });
}

document.addEventListener('DOMContentLoaded', restore_options);
document.getElementById('save').addEventListener('click', save_options);

