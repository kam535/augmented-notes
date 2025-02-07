import os from 'os';
import path from 'path';
import urllib from 'urllib';
import webapp2 from 'webapp2';
import sys from 'sys';
import glob from 'glob';
import zipfile from 'zipfile';
import { StringIO } from 'stringio';
import json from 'json';
import requests from 'requests';

// For local testing only, the local runner seems to miss lxml
sys.path.append("/Users/dplepage/.virtualenvs/augnotes/lib/python2.7/site-packages/");
sys.path.append("/Users/jswafford/.virtualenvs/AugNotes/lib/python2.7/site-packages/");
import lxml from 'lxml';

import { db } from 'google.appengine.ext';
import { users } from 'google.appengine.api';
import { blobstore } from 'google.appengine.ext';
import { blobstore_handlers } from 'google.appengine.ext.webapp';

import { TemplateLookup } from 'mako.lookup';

import { parse_mei } from 'parse_mei';

const templates = new TemplateLookup({ directories: ['templates'] });

// ===========================
// = Example Data Generators =
// ===========================

function make_empty_data(npages) {
  /** Generate empty data for an augmented score with npages pages. */
  return { pages: Array.from({ length: npages }, () => ({ measure_ends: [], measure_bounds: [] })) };
}

function get_or_create_example() {
  const example_key = db.Key.from_path("Song", "EXAMPLE");
  let example = db.get(example_key);
  if (!example) {
    const upload_url = blobstore.create_upload_url('/upload');
    const images = Array.from(glob.sync("example_data/pages/*.jpg")).sort();
    const files = [
      ['mp3', ['music.mp3', fs.createReadStream('example_data/music.mp3'), 'audio/mp3']],
      ['ogg', ['music.ogg', fs.createReadStream('example_data/music.ogg'), 'audio/ogg']],
    ];
    files.push(...images.map(f => ['page', [path.basename(f), fs.createReadStream(f), 'image/jpeg']]));
    const r = requests.post(upload_url, { files: files, allow_redirects: false });
    const key = parseInt(r.headers['location'].split("/box_edit/")[1]);
    const tmp = Song.get_by_id(key);
    example = new Song({ key_name: "EXAMPLE", mp3: tmp.mp3, ogg: tmp.ogg, page_list: tmp.page_list, json: tmp.json });
    example.put();
    tmp.delete();
  }
  return example;
}

function make_example(include_data = false) {
  const example = get_or_create_example();
  let json_string;
  if (include_data) {
    json_string = fs.readFileSync("example_data/data.js", 'utf8');
  } else {
    json_string = example.json;
  }
  const song = new Song({ mp3: example.mp3, ogg: example.ogg, page_list: example.page_list, json: json_string });
  song.put();
  return song;
}

class ExampleHandler extends webapp2.RequestHandler {
  get() {
    const song = make_example(false);
    this.redirect(`/box_edit/${song.key().id()}`);
  }
}

class DataExampleHandler extends webapp2.RequestHandler {
  get() {
    const song = make_example(true);
    this.redirect(`/time_edit/${song.key().id()}`);
  }
}

// ==============
// = Song Model =
// ==============

class Song extends db.Model {
  constructor(data) {
    super(data);
    this.mp3 = blobstore.BlobReferenceProperty({ required: true });
    this.ogg = blobstore.BlobReferenceProperty({ required: true });
    this.mei = blobstore.BlobReferenceProperty({ required: false });
    this.json = db.TextProperty({ required: false });
    this.page_list = db.ListProperty(blobstore.BlobKey, { required: true });
  }
}

// ====================
// = Login Management =
// ====================

function is_admin(user) {
  const allowed_emails = ['jswaffor@gmail.com', 'jes8zv@virginia.edu', 'dplepage@gmail.com'];
  return user !== null && allowed_emails.includes(user.email());
}

function check_login(handler) {
  return;
  // if (handler.request.host.startsWith("localhost")) {
  //   return;
  // }
  const user = users.get_current_user();
  if (!is_admin(user)) {
    handler.redirect('http://anglophileinacademia.blogspot.com/2013/01/a-progress-update-and-important.html');
  }
}

class SignInHandler extends webapp2.RequestHandler {
  get() {
    const user = users.get_current_user();
    if (!user) {
      this.redirect(users.create_login_url(this.request.uri));
    } else {
      this.redirect('/');
    }
  }
}

class SongInfo {
  constructor(song, example = null) {
    this.song = song;
    this.example = example;
    this.mp3 = blobstore.BlobInfo.get(song.mp3.key());
    this.ogg = blobstore.BlobInfo.get(song.ogg.key());
    this.from_example = this.like_example = this.is_example = false;
    if (example) {
      if (this.song.key().name() === this.example.song.key().name()) {
        this.is_example = true;
      }
    }
  }
}

