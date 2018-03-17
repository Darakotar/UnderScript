// ==UserScript==
// @name         UnderCards script
// @description  Minor changes to undercards game
// @require      https://raw.githubusercontent.com/feildmaster/SimpleToast/1.4.1/simpletoast.js
// @require      https://raw.githubusercontent.com/feildmaster/UnderScript/master/utilities.js?v=7
// @version      0.11
// @author       feildmaster
// @history     0.11 - Fix transparent deck preview, automatically sort deck
// @history   0.10.3 - Fix refreshing page, Log artifact activations
// @history   0.10.2 - Bump version so broken updates work (hopefully)
// @history   0.10.1 - Moved file to proper extension (makes fresh installs easier)
// @history     0.10 - Added deck card preview
// @history    0.9.2 - Fixed enemy names *again* (copy/pasting is bad)
// @history    0.9.1 - Spectate result music is now disabled if you disable music playing.
// @history    0.9.0 - Added detailed history log, log is top-bottom now, battle end is now a toast
// @history    0.8.5 - Added some game debug
// @history    0.8.4 - Removed "remember deck" feature (upstream), fixed event log
// @history    0.8.3 - Script works now
// @history    0.8.2 - Fix the queue disconnecting.
// @history    0.8.1 - Rework loading jQuery performance
// @history      0.8 - Better performance and reliability. Disable the join queue buttons until they are ready
// @history      0.7 - updated to new restrictions, thanks cloudflare -_-
// @history      0.6 - some upgrades to the battle log, fixed url
// @history    0.5.4 - Don't scroll the battle log with the page (possibly make this configurable later)
// @history    0.5.3 - Remove the chat stuff, the new chat is better.
// @history    0.5.2 - do the same for the chat window
// @history    0.5.1 - don't cover the battle screen
// @history      0.5 - remember chat messages on page-change, added a battle log, lots of code changes
// @history      0.4 - Remember "event deck" too!, also fixed bugs.
// @history      0.3 - Lowered "game found" volume
// @history      0.2 - Added EndTurn hotkey (space, middle click), focus chat (enter)
// @history      0.1 - Made deck selection smart
// @match        https://undercards.net/*
// @website      https://github.com/feildmaster/UnderScript
// @supportURL   https://github.com/feildmaster/UnderScript/issues
// @downloadURL  https://raw.githubusercontent.com/feildmaster/UnderScript/master/undercards.user.js
// @namespace    https://feildmaster.com/
// @grant        none
// ==/UserScript==

// === Variables start
const hotkeys = [];
// === Variables end

eventManager.on("getWaitingQueue", function lowerVolume() {
  // Lower the volume, the music changing is enough as is
  audioQueue.volume = 0.3;
});

eventManager.on("PlayingGame", function bindHotkeys() {
  // Binds to Space, Middle Click
  hotkeys.push(new Hotkey("End turn").bindKey(32).bindClick(2).run((e) => {
    if (!$(e.target).is("#endTurnBtn") && userTurn && userTurn === userId) endTurn();
  }));
});

eventManager.on("GameStart", function battleLogger() {
  const ignoreEvents = Object.keys({
    getConnectedFirst: '',
    refreshTimer: 'Never need to know about this one',
    getPlayableCards: 'On turn start, selects cards player can play',
    getTurn: 'Turn update',
    getCardDrawed: 'Add card to your hand',
    updateSpell: '',
    updateMonster: 'monster on board updated',
    getFakeDeath: 'Card "died" and respawns 1 second later',
    getMonsterTemp: "You're about to play a monster",
    getSpellTemp: "You're about to play a spell",
    getTempCancel: 'Temp card cancelled',
    getShowMulligan: 'Switching out hands, ignore it',
    getHideMulligan: 'Hide the mulligan, gets called twice',
    getUpdateHand: 'Updates full hand',
    getError: 'Takes you to "home" on errors, can be turned into a toast',
    getGameError: 'Takes you to "play" on game errors, can be turned into a toast',
  });
  let turn = 0, currentTurn = 0, players = {}, monsters = {}, lastEffect, other = {}, finished = false;
  const make = {
    player: function makePlayer(player, title = false) {
      const c = $('<span>');
      c.append(player.username);
      c.addClass(player.class);
      if (!title) {
        c.css('text-decoration', 'underline');
        // show lives, show health, show gold, show hand, possibly deck size as well
        const data = `${player.hp} hp, ${player.gold} gold`;
        c.hover(hover.show(data, '2px solid white'));
      }
      return c;
    },
    card: function makeCard(card) {
      const c = $('<span>');
      c.append(card.name);
      c.css('text-decoration', 'underline');

      let data = `<table class="cardBoard ${card.paralyzed ? 'paralyzed' : ''}">`;
      data += `<tr><td class="cardName resize ${card.classe || card.class}" colspan="3">${card.name}`;
      if (card.shiny) {
        // TODO: rainbow
      }
      // TODO: skins
      data += `</td><td class="cardCost">${card.cost}</td></tr>`;
      data += `<tr><td id="cardImage" colspan="4">`;
      const status = fn.cardStatus(card);
      if (status.length) {
        // add status images
        status.forEach((s, i) => {
          data += `<img class="infoPowers" style="z-index:20;right:${4 + i * 20}px;" src="images/powers/${s}.png"/>`;
        });
      }
      data += `<img src="images/cards/${card.image}.png"/></td></tr>`;
      data += `<tr><td class="cardDesc" colspan="4">${card.desc || ''}`
      if (card.silence) {
        data += '<img class="silenced" title="Silence" src="images/silence.png">';
      }
      data += '</td></tr>';
      if (!card.typeCard) {
        data += `<tr><td id="cardATQ">${card.attack}</td><td id="cardRarity" colspan="2"><img src="images/rarity/${card.rarity}.png" /></td><td id="cardHP" class="${card.hp!==card.maxHp ? "damaged" : ""}">${card.hp}</td></tr>`;
      } else {
        data += `<tr><td id="cardRarity" colspan="4"><img src="images/rarity/${card.rarity}.png" /></td></tr>`;
      }
      data += `</table>`;
      c.hover(hover.show(data));
      return c;
    },
  };

  eventManager.on('GameEvent', function logEvent(data) {
    if (finished) { // Sometimes we get events after the battle is over
      fn.debug(`Extra action: ${data.action}`, 'debugging.events.extra');
      return;
    }
    debug(data.action, 'debugging.events.name');
    const emitted = eventManager.emit(data.action, data).ran;
    if (!emitted) {
      fn.debug(`Unknown action: ${data.action}`);
    }
  });

  eventManager.on('PreGameEvent', function callPreEvent(data) {
    if (finished) return;
    const event = eventManager.emit(`${data.action}:before`, data, this.cancelable);
    if (!event.ran) return;
    this.canceled = event.canceled;
  });

  eventManager.on('getAllGameInfos getGameStarted getReconnection', function initBattle(data) {
    debug(data, 'debugging.raw.game');
    let you, enemy;
    // Battle logging happens after the game runs
    if (this.event === 'getGameStarted') {
      you = {
        id: data.yourId,
        username: data.yourUsername,
        hp: 30, // This is wrong with artifacts? Maybe?
        gold: 2, // This is wrong with artifacts? Maybe?
      };
      enemy = {
        id: data.enemyId,
        username: data.enemyUsername,
        hp: 30, // This is wrong with artifacts? Maybe?
        gold: 2, // This is wrong with artifacts? Maybe?
      };
    } else {
      you = JSON.parse(data.you);
      enemy = JSON.parse(data.enemy);
      // Set gold
      const gold = JSON.parse(data.golds);
      you.gold = gold[you.id];
      enemy.gold = gold[enemy.id];
      // Set lives
      const lives = JSON.parse(data.lives);
      you.lives = lives[you.id];
      enemy.lives = lives[enemy.id];
      // populate monsters
      JSON.parse(data.board).forEach(function (card) {
        if (card === null) return;
        // id, attack, hp, maxHp, originalattack, originalHp, typeCard, name, image, cost, originalCost, rarity, shiny, quantity
        card.desc = getDescription(card);
        monsters[card.id] = card;
      });
    }
    you.level = data.yourLevel;
    you.class = data.yourClass;
    you.rank = data.yourRank;
    enemy.level = data.enemyLevel;
    enemy.class = data.enemyClass;
    enemy.rank = data.enemyRank;
    // yourArtifacts, yourAvatar {id, image, name, rarity, ucpCost}, division, oldDivision, profileSkin {id, name, image, ucpCost}
    debug({you, enemy}, 'debugging.game');
    turn = data.turn || 0;
    players[you.id] = you;
    players[enemy.id] = enemy;
    // Test changing ID's at endTurn instead of startTurn
    other[you.id] = enemy.id;
    other[enemy.id] = you.id;
    // Initialize the log
    log.init();
    $("div#history div.handle").html('').append(`[${data.gameType}] `, make.player(you), ' vs ', make.player(enemy));
    log.add(`Turn ${turn}`);
    if (data.userTurn) {
      currentTurn = data.userTurn;
      log.add(make.player(players[data.userTurn]), "'s turn");
    }
  });
  eventManager.on('getFight getFightPlayer', function fight(data) {
    const target = this.event === 'getFightPlayer' ? make.player(players[data.defendPlayer]) : make.card(monsters[data.defendMonster]);
    log.add(make.card(monsters[data.attackMonster]), ' attacked ', target);
  });
  eventManager.on('getUpdatePlayerHp', function updateHP(data) {
    debug(data, 'debugging.raw.updateHP');
    const oHp = players[data.playerId].hp;
    const hp = data.isDamage ? oHp - data.hp : data.hp - oHp;
    players[data.playerId].hp = data.hp;
    if (oHp !== data.hp) { // If the player isn't at 0 hp already
      log.add(make.player(players[data.playerId]), ` ${data.isDamage ? "lost" : "gained"} ${hp} hp`);
    }
    if (data.hp === 0 && players[data.playerId].lives > 1 && !players[data.playerId].hasOwnProperty("lostLife")) { // If they have extra lives, and they didn't lose a life already
      log.add(make.player(players[data.playerId]), ' lost a life');
      players[data.playerId].lostLife = true;
    }
  });
  eventManager.on('getDoingEffect', function doEffect(data) {
    debug(data, 'debugging.raw.effect');
    // affecteds: [ids]; monsters affected
    // playerAffected1: id; player affected
    // playerAffected2: id; player affected
    // TODO: Figure out how to do this better
    if (lastEffect === 'm' + data.monsterId) return;
    lastEffect = 'm' + data.monsterId;
    log.add(make.card(monsters[data.monsterId]), "'s effect activated");
  });
  eventManager.on('getArtifactDoingEffect', function doEffect(data) {
    debug(data, 'debugging.raw.effectArtifact');
    if (lastEffect === 'a' + data.playerId) return;
    lastEffect = 'a' + data.playerId;
    log.add(make.player(players[data.playerId]), "'s artifact activated");
  });
  eventManager.on('getSoulDoingEffect', function soulEffect(data) {
    debug(data, 'debugging.raw.effectSoul');
    if (lastEffect === 's' + data.playerId) return;
    lastEffect = 's' + data.playerId;
    log.add(make.player(players[data.playerId]), "'s soul activated");
    // affecteds
    // playerAffected1
    // playerAffected2
  });
  eventManager.on('getTurnStart', function turnStart(data) {
    debug(data, 'debugging.raw.turnStart');
    lastEffect = 0;
    if (data.numTurn !== turn) {
      log.add(`Turn ${data.numTurn}`);
    }
    currentTurn = data.idPlayer; // It would (kindof) help to actually update who's turn it is
    turn = data.numTurn;
    log.add(make.player(players[currentTurn]), "'s turn");
  });
  eventManager.on('getTurnEnd', function turnEnd(data) {
    debug(data, 'debugging.raw.turnEnd');
    // Lets switch the turn NOW, rather than later, the purpose of this is currently unknown... It just sounded like a good idea, also delete the "lostLife" flag...
    if (time <= 0) {
      log.add(make.player(players[currentTurn]), ' timed out');
    }
    delete players[currentTurn].lostLife;
    currentTurn = other[data.idPlayer];
    delete players[currentTurn].lostLife;
    lastEffect = 0;
  });
  eventManager.on('getUpdateBoard', function updateGame(data) {
    debug(data, 'debugging.raw.boardUpdate');
    const oldMonsters = monsters;
    monsters = {};
    // TOOD: stuff....
    JSON.parse(data.board).forEach(function (card) {
      if (card === null) return;
      card.desc = getDescription(card);
      monsters[card.id] = card;
    });
  });
  eventManager.on('getMonsterDestroyed', function monsterKilled(data) {
    debug(data, 'debugging.raw.kill');
    // monsterId: #
    log.add(make.card(monsters[data.monsterId]), ' was killed');
    delete monsters[data.monsterId];
  });
  eventManager.on('getCardBoard', function playCard(data) { // Adds card to X, Y (0(enemy), 1(you))
    debug(data, 'debugging.raw.boardAdd');
    const card = JSON.parse(data.card);
    card.desc = getDescription(card);
    monsters[card.id] = card;
    log.add(make.player(players[data.idPlayer]), ' played ', make.card(card));
  });
  eventManager.on('getSpellPlayed', function useSpell(data) {
    debug(data, 'debugging.raw.spell');
    // immediately calls "getDoingEffect" and "getUpdateBoard"
    const card = JSON.parse(data.card);
    card.desc = getDescription(card);
    monsters[card.id] = card;
    log.add(make.player(players[data.idPlayer]), ' used ', make.card(card));
  });
  eventManager.on('getShowCard', function showCard(data) {
    const card = JSON.parse(data.card);
    card.desc = getDescription(card);
    log.add(make.player(players[data.idPlayer]), ' exposed ', make.card(card));
  });
  eventManager.on('getCardDestroyedHandFull', function destroyCard(data) {
    debug(data, 'debugging.raw.fullHand');
    const card = JSON.parse(data.card);
    card.desc = getDescription(card);
    debug(data.card);
    // This event gets called for *all* discards. Have to do smarter logic here (not just currentTurn!)
    log.add(make.player(players[currentTurn]), ' discarded ', make.card(card));
  });
  eventManager.on('getPlayersStats', function updatePlayer(data) { // TODO: When does this get called?
    debug(data, 'debugging.raw.stats');
    let key, temp = JSON.parse(data.handsSize);
    for (key in temp) {
      // TODO: hand size monitoring
      //players[key].hand
    }
    // TODO: deck monitoring (decksSize)
    temp = JSON.parse(data.golds);
    for (key in temp) {
      players[key].gold = temp[key];
    }
    temp = JSON.parse(data.lives);
    for (key in temp) {
      players[key].lives = temp[key];
    }
    // data.artifcats
    // data.turn
  });
  eventManager.on('getVictory getVictoryDeco getDefeat', function gameEnd(data) {
    debug(data, 'debugging.raw.end');
    finished = true;
    if (this.event === 'getVictoryDeco') {
      log.add(make.player(players[opponentId]), " left the game");
    }
    const you = make.player(players[userId]);
    const enemy = make.player(players[opponentId]);
    if (this.event === 'getDefeat') {
      log.add(enemy, ' beat ', you);
    } else {
      log.add(you, ' beat ', enemy);
    }
  });
  eventManager.on('getResult', function endSpectating(data) {
    debug(data, 'debugging.raw.end');
    finished = true;
    if (data.cause === "Surrender") {
      log.add(`${data.looser} surrendered.`);
    } else if (data.cause === "Disconnection") {
      log.add(`${data.looser} disconnected.`);
    }
    // TODO: colorize
    log.add(`${data.winner} beat ${data.looser}`);
  });
  eventManager.on('getResult:before', function overrideResult(data) {
    if (fn.isSet('setting.disable.resultToast')) return;
    // We need to mark the game as finished (like the source does)
    finish = true;
    this.canceled = true;
    const toast = {
      title: 'Game Finished',
      text: 'Return Home',
      buttons: {
        className: 'skiptranslate',
        text: '🏠',
        onclick: () => {
          document.location.href = "/";
        },
      },
    };
    fn.toast(toast);
  });
  eventManager.on(ignoreEvents.join(' '), function ignore(data) {
    debug(data, 'debugging.raw.ignore');
    debug(data, `debugging.raw.ignore.${this.event}`);
  });
});

eventManager.on('GameStart', function soundManager() {
  const canDisableMusic = typeof musicEnabled === 'boolean';
  let spectating = true;
  let disabledMusic = false;
  let disabledSound = false;
  let startedBGM = false;

  function isMusicDisabled() {
    return !fn.isSet('gameMusicDisabled', null);
  }
  function disableMusic() {
    if (!canDisableMusic || !musicEnabled) return;
    debug('Disabled music', 'debugging.music');
    musicEnabled = false;
    disabledMusic = true;
  }
  function disableSound() {
    if (!soundEnabled) return;
    debug('Disabled sound', 'debugging.sound');
    soundEnabled = false;
    disabledSound = true;
  }
  function restoreAudio() {
    if (disabledMusic) {
      musicEnabled = true;
    }
    if (disabledSound) {
      soundEnabled = true;
    }
  }
  function stopAudio(audio) {
    if (!(audio instanceof Audio)) return;
    if (audio.readyState) return audio.pause();
    // the "proper" way to stop audio (before it starts)
    audio.addEventListener('playing', function () {
      audio.pause();
    });
  }
  function playMusic(src, opts = { volume: 0.2 }) {
    if (!opts.force && canDisableMusic ? !musicEnabled : isMusicDisabled()) return;
    music = new Audio(src);
    music.volume = opts.volume || 0.2;
    if (opts.repeat) {
      music.addEventListener('ended', function () {
        this.currentTime = 0;
        this.play();
      }, false);
    }
    music.play();
  }

  eventManager.on('GameEvent', restoreAudio);
  eventManager.on('PlayingGame', function () {
    spectating = false;
  });
  eventManager.on('getGameStarted:before getReconnection:before', function disableBGM(data) {
    if (fn.isSet('setting.disable.bgm')) disableMusic();
  }).on('getGameStarted:before', function disableGameStart(data) {
    if (fn.isSet('setting.disable.gameStart')) disableSound();
  });
  eventManager.on('getAllGameInfos', function spectateBGM(data) {
    if (!fn.isSet('setting.enable.bgm.spectate')) return;
    const numBackground = randomInt(1, 10);
    console.log('set background', numBackground);
    // set the new background (ugh)
    $('body').css('background', `#000 url('images/backgrounds/${numBackground}.png') no-repeat`);
    playMusic(`musics/themes/${numBackground}.ogg`, { volume: 0.1, repeat: true });
    startedBGM = true;
  });
  eventManager.on('getCardBoard:before', function disableLegendary(data) {
    const card = JSON.parse(data.card);
    const disableLegendary = card.rarity === 'LEGENDARY' && fn.isSet('setting.disable.legendary');
    const disableDT = card.rarity === 'DETERMINATION' && fn.isSet('setting.disable.determination');
    if (disableLegendary || disableDT) {
      disableSound();
    }
  });
  eventManager.on('getSpellPlayed:before', function disableSpells(data) {
    if (fn.isSet('setting.disable.spells')) disableSound();
  });
  eventManager.on('getCardDestroyedHandFull:before', function disableHandFull(data) {
    if (fn.isSet('setting.disable.handFull')) {
      setTimeout(disableSound, 1000); // I really don't like this, but it apparently works
    }
  }).on('getCardDestroyedHandFull', function restoreHandFull(data) {
    if (fn.isSet('setting.disable.handFull')) {
      setTimeout(restoreAudio, 1000); // I really don't like this, but it apparently works
    }
  });
  eventManager.on('getMonsterDestroyed:before getFakeDeath:before', function disableDestroy(data) {
    if (fn.isSet('setting.disable.destroy')) disableSound();
  }).on('getFakeDeath:before', function disableDestroyTimeout(data) {
    if (fn.isSet('setting.disable.destroy')) {
      setTimeout(disableSound, 1000); // I really don't like this, but it apparently works
    }
  }).on('getFakeDeath', function restoreDestroy() {
    if (fn.isSet('setting.disable.destroy')) {
      setTimeout(restoreAudio, 1000); // I really don't like this, but it apparently works
    }
  });
  eventManager.on('getUpdatePlayerHp:before', function disablePlayerHealth(data) {
    if (data.isDamage ? fn.isSet('setting.disable.damage') : fn.isSet('setting.disable.heal')) {
      disableSound();
    }
  });
  eventManager.on('getVictory:before', function preGame(data) {
    if (fn.isSet('setting.disable.destroy.enemy')) {
      setTimeout(disableSound, 750); // untested
      setTimeout(restoreAudio, 751);
    }
    if (data.endPromo) {
      // Level up is stored in "audio", what a pain.
      if (data.gameType === "RANKED") {
        // timeout: 2750
        let disable = null;
        if (data.newDivision === 'MASTER') {
          // reachMaster
        } else {
          // rankUp
        }
        // music
        if (disable && fn.isSet(disable)) { // untested
          // we don't care about re-enabling it
          setimeout(disableMusic, 2750);
        }
      }
    } else if (data.oldDivision !== "LEGEND" && data.newDivision === "LEGEND") {
      if (fn.isSet('setting.disable.legendary')) { // untested
        // we don't care about re-enabling it?
        setTimeout(disableMusic, 2750);
      }
    }
    if (!data.endPromo) {
      // More complex stuff
    }
  }).on('getDefeat:before', function preGame(data) {
    if (data.endType === 'Chara') {
      // 'audio' 'hit'
      // timeout 750: music 'toomuch'
    } else {
      // timeout 750: 'audio' 'soulDeath'
    }
    // timeout 750 + 2200: music 'gameover' || 'toomuch'
    if (data.nbLevelPassed) {
      // interval, 5
      // 'audio' plays 'levelUp'
    }
    if (data.oldDivision !== data.newDivision && data.newDivision === 'LEGEND') {
      // timeout 750 + 2200: music 'dogsong'
    }
  });
  eventManager.on('getResult:before', function restoreSpectateMusic(data) {
    if (startedBGM) stopAudio(music);
    // getResult hasn't been canceled, music is disabled, we disable spectateMusic
    if (!this.canceled || isMusicDisabled() || fn.isSet('setting.disable.finish.spectate')) return;
    // Play the music, because it got canceled >.>
    playMusic('musics/victory.ogg');
  }).on('getResult', function stopSpectateMusic(data) {
    // music is undefined, music is not disabled, we do not disable spectate music
    if (typeof music === 'undefined' || !isMusicDisabled() && !fn.isSet('setting.disable.finish.spectate')) return;
    // if music != undefined && (isMusicDisabled || DisableFinish)
    stopAudio(music);
  });
  // Override toggleMusic?
});

// === Play hooks
onPage("Play", function () {
  // TODO: Better "game found" support
  debug("On play page");
  let queues, disable = true;

  eventManager.on("jQuery", function onPlay() {
    if (disable) {
      queues = $("button.btn.btn-primary");
      queues.prop("disabled", true);
    }
  });

  (function hook() {
    if (typeof socketQueue === "undefined") {
      debug("Timeout hook");
      return setTimeout(hook);
    }
    socket = socketQueue;
    const oOpen = socketQueue.onopen;
    socketQueue.onopen = function onOpenScript(event) {
      disable = false;
      oOpen(event);
      if (queues) queues.prop("disabled", false);
    };
    const oHandler = socketQueue.onmessage;
    socketQueue.onmessage = function onMessageScript(event) {
      const data = JSON.parse(event.data);
      oHandler(event);
      eventManager.emit(data.action, data);
    };
  })();
});

// === Game hooks
onPage("Game", function () {
  debug("Playing Game");
  eventManager.emit("GameStart");
  eventManager.emit("PlayingGame");
  (function hook() {
    if (typeof socket === 'undefined') {
      debug("Timeout hook");
      return setTimeout(hook);
    }
    const oHandler = socket.onmessage;
    socket.onmessage = function onMessageScript(event) {
      const data = JSON.parse(event.data);
      eventManager.emit('PreGameEvent', data);
      oHandler(event);
      eventManager.emit('GameEvent', data);
    };
  })();
});

// Deck hook
onPage('Decks', function () {
  debug('Deck editor');
  function hoverCard(element) {
    const id = element.attr('id');
    const shiny = element.hasClass('shiny') ? '.shiny' : '';
    const card = $(`table#${id}${shiny}:lt(1)`).clone();
    if (card.length !== 1) return;
    card.find('#quantity').remove();
    if (card.css('opacity') !== '1') card.css('opacity', 1);
    loadCard(card);
    return hover.show(card);
  }
  // Initial load
  $('li.list-group-item').each(function (index) {
    const element = $(this);
    element.hover(hoverCard(element));
  });
  $(document).ajaxSuccess((event, xhr, settings) => {
    const data = JSON.parse(settings.data);
    if (data.action === 'removeCard') { // Card was removed, hide element
      hover.hide();
    } else if (data.action === 'addCard') { // Card was added
      const element = $(`#deckCards${data.classe} li:last`);
      element.hover(hoverCard(element, true));

      const list = $(`#deckCards${data.classe}`);
      list.append(list.children('li').detach().sort(function (a, b) {
        const card1 = $(`table#${$(a).attr('id')}`);
        const card2 = $(`table#${$(b).attr('id')}`);
        const card1cost = parseInt(card1.find('.cardCost').html(), 10);
        const card2cost = parseInt(card2.find('.cardCost').html(), 10);
        if (card1cost === card2cost) {
          return card1.find('.cardName').html() > card2.find('.cardName').html() ? 1 : -1;
        }
        return card1cost > card2cost ? 1 : -1;
      }));
    }
  });
});

// Spectate hooks
onPage("gameSpectate", function () {
  debug("Spectating Game");
  eventManager.emit("GameStart");
  (function hook() {
    if (typeof socket === "undefined") {
      debug("Timeout hook");
      return setTimeout(hook);
    }
    const oHandler = socket.onmessage;
    socket.onmessage = function onMessageScript(event) {
      const data = JSON.parse(event.data);
      const e = eventManager.emit('PreGameEvent', data, data.action === 'getResult');
      if (!e.canceled) oHandler(event);
      eventManager.emit('GameEvent', data);
    };
  })();
});

// === Always do the following - if jquery is loaded
eventManager.on("jQuery", function always() {
  // Bind hotkey listeners
  $(document).on("click.script", function (event) {
    if (false) return; // TODO: Check for clicking in chat
    hotkeys.forEach(function (v) {
      if (v.clickbound(event.which)) {
        v.run(event);
      }
    });
  });
  $(document).on("keyup.script", function (event) {
    if ($(event.target).is("input")) return; // We don't want to listen while typing in chat (maybe listen for F-keys?)
    hotkeys.forEach(function (v) {
      if (v.keybound(event.which)) {
        v.run(event);
      }
    });
  });
  /* This legacy code doesn't work
  $(window).unload(function() {
    // Store chat text (if any)
    var val = $("div.chat-public input.chat-text").val();
    if (!val) return;
    localStorage.oldChat = val;
  });
  if (localStorage.oldChat) {
    $("div.chat-public input.chat-text").val(localStorage.oldChat);
    delete localStorage.oldChat;
  }
  // */
});

// Attempt to detect jQuery
let tries = 20;
(function jSetup() {
  if (typeof jQuery === "undefined") {
    if (tries-- <= 0) { // jQuery is probably not going to load at this point...
      return;
    }
    setTimeout(jSetup, 1);
    return;
  }
  eventManager.emit("jQuery");
})();
