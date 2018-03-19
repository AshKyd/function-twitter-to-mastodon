const path = require('path');
const Twitter = require('twitter');
const Mastodon = require('mastodon');
const async = require('async');
const he = require('he');
const similarity = require('similarity');
const striptags = require('striptags');


const t = new Twitter(require(path.join(__dirname, 'secrets.twitter')));
const m = new Mastodon(require(path.join(__dirname, 'secrets.mastodon')));

const usernames = require('./usernames');

function getMastodonStatuses(done) {
  m.get('accounts/verify_credentials', {}, (error, account) => {
    if (error) return done(error);
    return m.get(`accounts/${account.id}/statuses`, (a, b) => done(a, b));
  });
}
function getTweets(done) {
  t.get('statuses/user_timeline', { screen_name: 'eventsbne', tweet_mode: 'extended', count: 3 }, (a, b) => done(a, b));
}

function replaceUrls(text, tweet) {
  if (tweet.entities && tweet.entities.urls) {
    tweet.entities.urls.forEach((url) => {
      text = text.replace(url.url, url.expanded_url);
    });
  }
  return text;
}

function hideImages(text, tweet) {
  if (tweet.entities && tweet.entities.media) {
    tweet.entities.media.forEach((media) => {
      // replace media urls, including the space before
      text = text.replace(` ${media.url}`, '');
    });
  }
  return text;
}

/**
 * Sanitise a tweet so it's suitable to post to Mastodon
 */
function prettyPrint(tweet, callback) {
  let text = he.decode(tweet.full_text);

  // Replace any RT portion, we'll add it back later.
  text = text.replace(/RT\s@.*/g, '').trim();

  // Add the RT portion back in full
  if (tweet.retweeted_status || tweet.quoted_status) {
    const retweet = tweet.retweeted_status || tweet.quoted_status;
    if (text.length !== 0) text += '\n';
    text += `> “${he.decode(retweet.full_text).replace(/\n/g, '\n> ')}” - ${retweet.user.name} (@${retweet.user.screen_name})`;
    text = replaceUrls(text, retweet);
    text = hideImages(text, retweet);
  }

  // Replace Twitter usernames with @twitter.com references
  text = text.replace(/(@[A-Za-z0-9_]+)/g, '$1@twitter.com');

  // Replace known usernames with local usernames
  Object.keys(usernames).forEach((username) => {
    text = text.replace(username, usernames[username]);
  });

  // TODO: fetch & upload media

  // replace Twitter links with regular links
  text = replaceUrls(text, tweet);

  // hide links to statuses (these show up sometimes in quote tweets)
  text = text.replace(/\s?https...twitter.com\/[^\s]+/, '');

  return text.trim();
}

function findNew({ tweets, toots }, done) {
  const prettyTweets = tweets
    .filter(tweet => new Date(tweet.created_at) > Date.now() - (1000 * 60 * 20))
    .map(prettyPrint);
  const prettyToots = toots.map(toot => striptags(toot.content));
  const missing = prettyTweets
    .filter(tweet => !prettyToots.find(toot => similarity(toot, tweet) > 0.95));
  done(null, missing);
}

function postMissing({ newTweets }, done) {
  newTweets.reverse();
  async.eachSeries(newTweets, (status, tDone) => {
    console.log('POSTING', { status });
    m.post('statuses', { status }, tDone);
  }, done);
}

exports.main = (req, res) => {
  async.auto({
    toots: getMastodonStatuses,
    tweets: getTweets,
    newTweets: ['tweets', 'toots', findNew],
    // postMissing: ['newTweets', postMissing],
  }, function(error) {
    if (error) {
      console.error(error);
      throw error;
    }
    res.status(200).send('updated');
  });
};
