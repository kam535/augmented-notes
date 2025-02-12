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
        self.like_example = self.mp3.md5_hash === example.mp3.md5_hash;
self.like_example &= self.ogg.md5_hash === example.ogg.md5_hash;

if (this.mp3 === null || this.ogg === null) {
  this.deleted = true;
  this.pages = [];
  this.total_size = 0;
  this.npages = 0;
  return;
}

this.pages = song.page_list.map(k => blobstore.BlobInfo.get(k));
this.total_size = this.mp3.size + this.ogg.size;
this.total_size += this.pages.reduce((sum, p) => sum + p.size, 0);
this.npages = this.pages.length;

class ListSongsHandler extends webapp2.RequestHandler {
  get() {
    if (!is_admin(users.get_current_user())) {
      this.redirect(users.create_login_url(this.request.uri));
      return;
    }
    const example = new SongInfo(get_or_create_example());
    const page = parseInt(this.request.get("page", 1));
    const nitems = parseInt(this.request.get("nitems", 20));
    const offset = (page - 1) * nitems;
    let total_items = offset + Song.all().count({ offset: offset, limit: 600 });
    if (total_items === offset + 600) {
      total_items = null;
    }
    const songs = Song.all().run({ offset: offset, limit: nitems });
    const template = templates.get_template("list.mako");

    this.response.out.write(template.render({
      total_items: total_items,
      offset: offset,
      nitems: nitems,
      songs: songs.map(s => new SongInfo(s, example)),
      example: example
    }));
  }
}

function delete_song(song, example) {
  if (!is_admin(users.get_current_user())) {
    throw new Error();
  }
  if (song.key().name() === 'EXAMPLE') {
    throw new Error();
  }
  let blobs = [song.mp3.key(), song.ogg.key()].concat(song.page_list);
  const do_not_delete = [example.mp3.key(), example.ogg.key()].concat(example.page_list);
  blobs = [...new Set(blobs)].filter(blob => !do_not_delete.includes(blob));
  song.delete();
  blobstore.delete(blobs);
}

class DeleteHandler extends webapp2.RequestHandler {
  post(song_id) {
    if (!is_admin(users.get_current_user())) {
      this.redirect(users.create_login_url(this.request.uri));
      return;
    }
    const song = Song.get_by_id(parseInt(song_id));
    const example = get_or_create_example();
    delete_song(song, example);
    return this.redirect("/songs");
  }
}

class DeleteManyHandler extends webapp2.RequestHandler {
  post() {
    const example = get_or_create_example();
    this.request.POST.getall("ids").forEach(song_id => {
      const song = Song.get_by_id(parseInt(song_id));
      delete_song(song, example);
    });
    return this.redirect("/songs");
  }
}

class MainHandler extends webapp2.RequestHandler {
  get() {
    check_login(this);
    let upload_url;
    try {
      upload_url = blobstore.create_upload_url('/upload');
    } catch {
      upload_url = null;
    }
    const empty = Boolean(this.request.get('empty'));
    const template = templates.get_template("index.mako");
    this.response.out.write(template.render({ upload_url: upload_url, empty: empty }));
  }
}

class UploadHandler extends blobstore_handlers.BlobstoreUploadHandler {
  post() {
    check_login(this);
    const mp3_list = this.get_uploads('mp3');
    const ogg_list = this.get_uploads('ogg');
    const mei_list = this.get_uploads('mei');
    const page_list = this.get_uploads('page');
    if (!mp3_list.length || !ogg_list.length || !page_list.length) {
      this.redirect("/?empty=1");
      return;
    }
    const mp3 = mp3_list[0].key();
    const ogg = ogg_list[0].key();
    const pages = page_list.map(page => page.key());
    let mei, json_data;
    if (mei_list.length) {
      mei = mei_list[0].key();
      json_data = parse_mei(blobstore.BlobReader(mei).read());
    } else {
      mei = null;
      json_data = make_empty_data(pages.length);
    }
    const song = new Song({
      mp3: mp3,
      ogg: ogg,
      mei: mei,
      json: JSON.stringify(json_data),
      page_list: pages,
    });
    song.put();
    this.redirect(`/box_edit/${song.key().id()}`);
  }
}

function serve_url(key) {
  return `/serve/${key}`;
}

class SongEditHandler extends webapp2.RequestHandler {
  template_name = null;
  next_url = null;

  get_song_or_404(song_id) {
    let song_id;
    try {
      song_id = parseInt(song_id);
    } catch (ValueError) {
      this.abort(404);
    }
    const song = Song.get_by_id(song_id);
    if (song === null) {
      this.abort(404);
    }
    return song;
  }

  get(song_id) {
    check_login(this);
    const song = this.get_song_or_404(song_id);
    const urls = {};
    urls['mp3'] = serve_url(song.m);
    const urls = {};
    urls['ogg'] = serveUrl(song.ogg.key());
    urls['pages'] = song.page_list.map(key => serveUrl(key));
    const data = JSON.parse(song.json);
    const template = templates.getTemplate(this.templateName);
    this.response.out.write(template.render({ data: data, urls: urls, song_id: song_id }));

  post(song_id) {
      checkLogin(this);
      const song = this.getSongOr404(song_id);
      song.json = this.request.get('data');
      song.put();
      this.redirect(this.nextUrl.replace('{0}', song.key().id()));
  }
  
  class BoxEditHandler extends SongEditHandler {
      templateName = 'box_edit.mako';
      nextUrl = '/time_edit/{0}';
  }
  
  class TimeEditHandler extends SongEditHandler {
      templateName = 'time_edit.mako';
      nextUrl = '/zip/{0}';
  }
  
  class ZipFileHandler extends webapp2.RequestHandler {
      get(song_id) {
          checkLogin(this);
          let songId;
          try {
              songId = parseInt(song_id);
          } catch (error) {
              this.error(404);
              return;
          }
          const song = Song.getById(songId);
          const output = new Blob();
          const z = new JSZip();
          z.file("export/data/music.mp3", blobstore.BlobReader(song.mp3).read());
          z.file("export/data/music.ogg", blobstore.BlobReader(song.ogg).read());
          z.file("export/static/js/augnotes.js", fs.readFileSync("export_assets/augnotes.js"));
          z.file("export/static/js/augnotesui.js", fs.readFileSync("export_assets/augnotesui.js"));
          z.file("export/static/js/jquery.js", fs.readFileSync("export_assets/jquery.js"));
          z.file("export/static/css/export.css", fs.readFileSync("export_assets/export.css"));
          z.file("export/static/img/augnotes_badge.png", fs.readFileSync("export_assets/augnotes_badge.png"));
          const pageUrls = [];
          for (const page of song.page_list) {
              const pageInfo = blobstore.BlobInfo.get(page);
              const fname = `export/data/pages/${pageInfo.filename}`;
              pageUrls.push(`./data/pages/${pageInfo.filename}`);
              z.file(fname, blobstore.BlobReader(page).read());
          }
          const urls = {};
          urls['mp3'] = "./data/music.mp3";
          urls['ogg'] = "./data/music.ogg";
          urls['pages'] = pageUrls;
          const data = JSON.parse(song.json);
          const template = templates.getTemplate("export/archive.mako");
          const pageSrc = template.render({ data: data, urls: urls, song_id: song_id });
          z.file("export/archive.html", pageSrc);
          
          z.generateAsync({ type: "blob" }).then(content => {
              this.response.headers["Content-Type"] = "multipart/x-zip";
              this.response.headers['Content-Disposition'] = "attachment; filename=your_website.zip";
              this.response.out.write(content);
          });
      }
  }
  
  class ServeHandler extends blobstore_handlers.BlobstoreDownloadHandler {
      get(resource) {
          checkLogin(this);
          resource = decodeURIComponent(resource);
          const blobInfo = blobstore.BlobInfo.get(resource);
          this.sendBlob(blobInfo);
      }
  }
  
  const app = new webapp2.WSGIApplication([
      ['/', MainHandler],
      ['/delete_many', DeleteManyHandler],
      ['/songs', ListSongsHandler],
      ['/delete/([^/]+)', DeleteHandler],
      ['/upload', UploadHandler],
      ['/login', SignInHandler],
      ['/serve/([^/]+)', ServeHandler],
      ['/time_edit/([^/]+)', TimeEditHandler],
      ['/box_edit/([^/]+)', BoxEditHandler],
      ['/zip/([^/]+)', ZipFileHandler],
      ['/example', ExampleHandler],
      ['/example_with_data', DataExampleHandler],
  ], { debug: true });
