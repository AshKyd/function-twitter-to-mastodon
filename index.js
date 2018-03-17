const path = require('path');
const Twitter = require('twitter');
const Mastodon = require('mastodon');
const async = require('async');
const he = require('he');

const t = new Twitter(require(path.join(__dirname, 'secrets.twitter')));
const m = new Mastodon(require(path.join(__dirname, 'secrets.mastodon')));

const usernames = require('./usernames')

function getMastodonStatuses(done) {
  m.get('accounts/verify_credentials', {}, (error, account) => {
    if(error) return done(error);
    m.get(`accounts/${account.id}/statuses`, (error, statuses) => {
      if(error) return done(error);
      console.log(statuses);
    });
  });
}
function getTweets(done){
  t.get('statuses/user_timeline', {screen_name: 'eventsbne', tweet_mode: 'extended'}, done);
}

function replaceUrls(text, tweet){
  if(tweet.entities && tweet.entities.urls){
    tweet.entities.urls.forEach(url => {
      text = text.replace(url.url, url.expanded_url);
    });
  }
  return text;
}

function hideImages(text, tweet){
  if(tweet.entities && tweet.entities.media){
    tweet.entities.media.forEach(media => {
      // replace media urls, including the space before
      text = text.replace(' ' + media.url, '');
    });
  }
  return text;
}

/**
 * Sanitise a tweet so it's suitable to post to Mastodon
 */
function sanitise(tweet, callback){
  let text = he.decode(tweet.full_text);

  // Replace any RT portion, we'll add it back later.
  text = text.replace(/RT\s@.*/g, '').trim();

  // Add the RT portion back in full
  if(tweet.retweeted_status || tweet.quoted_status){
    const retweet = tweet.retweeted_status || tweet.quoted_status;
    if(text.length !== 0) text += '\n';
    text += `> “${he.decode(retweet.full_text).replace(/\n/g, '\n> ')}” - ${retweet.user.name} (@${retweet.user.screen_name})`;
    text = replaceUrls(text, retweet);
    text = hideImages(text, retweet);
  }

  // Replace Twitter usernames with @twitter.com references
  text = text.replace(/(@[A-Za-z0-9_]+)/g, '$1@twitter.com');

  // Replace known usernames with local usernames
  Object.keys(usernames).forEach(username => {
    text = text.replace(username, usernames[username]);
  });

  // TODO: fetch & upload media

  // replace Twitter links with regular links
  text = replaceUrls(text, tweet);

  // hide links to statuses (these show up sometimes in quote tweets)
  text = text.replace(/\s?https...twitter.com\/[^\s]+/, '');

  return text.trim();
}

getTweets((error, tweets) => {

  const toot = sanitise(tweets[2]);
  console.log(toot);
  m.post('statuses', { status: toot })
  return;
  tweets.map(sanitise).forEach(tweet => console.log(tweet, tweet.length,'chars\n========================\n'));
});
