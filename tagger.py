import os
import base64
from mutagen import File
from mutagen.easyid3 import EasyID3
from mutagen.mp3 import MP3
from mutagen.id3 import ID3, COMM, APIC
from mutagen.flac import FLAC, Picture
from mutagen.mp4 import MP4, MP4Cover
from mutagen.oggvorbis import OggVorbis

def update_track_tags(file_path, tag_data):
    """
    Updates common metadata fields of the music file at file_path.
    Supported fields in tag_data:
      title, artist, album, album_artist, year, genre, track_number, disc_number, comment, composer, bpm
    """
    if not os.path.exists(file_path):
        return False, "File does not exist"

    try:
        # MP3 file
        if file_path.lower().endswith('.mp3'):
            try:
                tags = EasyID3(file_path)
            except Exception:
                # Add ID3 tags if they do not exist
                audio = MP3(file_path)
                audio.add_tags()
                audio.save()
                tags = EasyID3(file_path)

            mapping = {
                'title': 'title',
                'artist': 'artist',
                'album': 'album',
                'album_artist': 'albumartist',
                'year': 'date',
                'genre': 'genre',
                'track_number': 'tracknumber',
                'disc_number': 'discnumber',
                'composer': 'composer',
                'bpm': 'bpm'
            }

            for key, val in tag_data.items():
                easy_key = mapping.get(key)
                if easy_key:
                    if val is None or val == '':
                        if easy_key in tags:
                            del tags[easy_key]
                    else:
                        tags[easy_key] = [str(val)]
            tags.save()

            # Handle COMM (Comments) separately as EasyID3 doesn't support it by default
            if 'comment' in tag_data:
                comment = tag_data['comment']
                id3 = ID3(file_path)
                id3.delall('COMM')
                if comment and str(comment).strip():
                    id3.add(COMM(encoding=3, lang='eng', desc='Comment', text=[str(comment)]))
                id3.save()

        # FLAC file
        elif file_path.lower().endswith('.flac'):
            audio = FLAC(file_path)
            mapping = {
                'title': 'TITLE',
                'artist': 'ARTIST',
                'album': 'ALBUM',
                'album_artist': 'ALBUMARTIST',
                'year': 'DATE',
                'genre': 'GENRE',
                'track_number': 'TRACKNUMBER',
                'disc_number': 'DISCNUMBER',
                'comment': 'COMMENT',
                'composer': 'COMPOSER',
                'bpm': 'BPM'
            }

            for key, val in tag_data.items():
                tag_key = mapping.get(key)
                if tag_key:
                    if val is None or val == '':
                        if tag_key in audio:
                            del audio[tag_key]
                    else:
                        audio[tag_key] = [str(val)]
            audio.save()

        # MP4 / M4A file
        elif file_path.lower().endswith(('.m4a', '.mp4')):
            audio = MP4(file_path)
            mapping = {
                'title': '\xa9nam',
                'artist': '\xa9ART',
                'album': '\xa9alb',
                'album_artist': 'aART',
                'year': '\xa9day',
                'genre': '\xa9gen',
                'comment': '\xa9cmt',
                'composer': '\xa9wrt'
            }

            for key, val in tag_data.items():
                atom = mapping.get(key)
                if atom:
                    if val is None or val == '':
                        if atom in audio.tags:
                            del audio.tags[atom]
                    else:
                        audio.tags[atom] = [str(val)]

            if 'track_number' in tag_data:
                tr = tag_data['track_number']
                if tr is None or tr == '':
                    if 'trkn' in audio.tags:
                        del audio.tags['trkn']
                else:
                    try:
                        audio.tags['trkn'] = [(int(tr), 0)]
                    except ValueError:
                        pass

            if 'disc_number' in tag_data:
                ds = tag_data['disc_number']
                if ds is None or ds == '':
                    if 'disk' in audio.tags:
                        del audio.tags['disk']
                else:
                    try:
                        audio.tags['disk'] = [(int(ds), 0)]
                    except ValueError:
                        pass

            if 'bpm' in tag_data:
                bpm = tag_data['bpm']
                if bpm is None or bpm == '':
                    if 'tmpo' in audio.tags:
                        del audio.tags['tmpo']
                else:
                    try:
                        audio.tags['tmpo'] = [int(bpm)]
                    except ValueError:
                        pass
            audio.save()

        # OGG / OPUS files
        elif file_path.lower().endswith(('.ogg', '.opus')):
            audio = OggVorbis(file_path)
            mapping = {
                'title': 'TITLE',
                'artist': 'ARTIST',
                'album': 'ALBUM',
                'album_artist': 'ALBUMARTIST',
                'year': 'DATE',
                'genre': 'GENRE',
                'track_number': 'TRACKNUMBER',
                'disc_number': 'DISCNUMBER',
                'comment': 'COMMENT',
                'composer': 'COMPOSER',
                'bpm': 'BPM'
            }
            for key, val in tag_data.items():
                tag_key = mapping.get(key)
                if tag_key:
                    if val is None or val == '':
                        if tag_key in audio.tags:
                            del audio.tags[tag_key]
                    else:
                        audio.tags[tag_key] = [str(val)]
            audio.save()

        else:
            return False, "Unsupported file format for editing tags"

        return True, "Tags updated successfully"
    except Exception as e:
        print(f"[Tag Writer] Error editing tags for {file_path}: {e}")
        return False, str(e)

def update_artwork(file_path, art_base64=None, remove_art=False):
    """
    Updates or removes artwork for a music file.
    `art_base64` should be the base64-encoded image string (with or without data:image/... header).
    """
    if not os.path.exists(file_path):
        return False, "File does not exist"

    try:
        # Handle artwork removal
        if remove_art:
            if file_path.lower().endswith('.mp3'):
                id3 = ID3(file_path)
                id3.delall('APIC')
                id3.save()
            elif file_path.lower().endswith('.flac'):
                flac = FLAC(file_path)
                flac.clear_pictures()
                flac.save()
            elif file_path.lower().endswith(('.m4a', '.mp4')):
                mp4 = MP4(file_path)
                if 'covr' in mp4.tags:
                    del mp4.tags['covr']
                mp4.save()
            return True, "Artwork removed successfully"

        # Handle artwork update
        if art_base64:
            if ',' in art_base64:
                header, data = art_base64.split(',', 1)
                mime = header.split(';')[0].split(':')[1]
            else:
                data = art_base64
                mime = 'image/jpeg'

            img_bytes = base64.b64decode(data)

            if file_path.lower().endswith('.mp3'):
                id3 = ID3(file_path)
                id3.delall('APIC')
                id3.add(APIC(
                    encoding=3,
                    mime=mime,
                    type=3,  # Cover (front)
                    desc=u'Front Cover',
                    data=img_bytes
                ))
                id3.save()
            elif file_path.lower().endswith('.flac'):
                flac = FLAC(file_path)
                flac.clear_pictures()
                pic = Picture()
                pic.data = img_bytes
                pic.mime = mime
                pic.type = 3
                pic.desc = u'Front Cover'
                flac.add_picture(pic)
                flac.save()
            elif file_path.lower().endswith(('.m4a', '.mp4')):
                mp4 = MP4(file_path)
                fmt = MP4Cover.FORMAT_JPEG
                if mime == 'image/png':
                    fmt = MP4Cover.FORMAT_PNG
                mp4.tags['covr'] = [MP4Cover(img_bytes, imageformat=fmt)]
                mp4.save()
            return True, "Artwork updated successfully"

        return False, "No artwork data provided"
    except Exception as e:
        print(f"[Tag Writer] Artwork error for {file_path}: {e}")
        return False, str(e)
