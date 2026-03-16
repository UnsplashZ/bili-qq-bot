import logging
import re

from bilibili_api import article, audio, channel_series, cheese, favorite_list, interactive_video, note, topic, user

from ..auth.credential_store import load_credential
from ..logging_utils import service_log
from ..media.image_focus import get_image_focus_color

logger = logging.getLogger(__name__)


def _coalesce(*values):
    for value in values:
        if value not in (None, "", [], {}):
            return value
    return None


def _truncate_text(text, limit=600):
    if text is None:
        return ""
    text = str(text).strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "..."


def _strip_front_matter(markdown_text):
    if not markdown_text.startswith("---\n"):
        return markdown_text
    parts = markdown_text.split("\n---\n", 1)
    return parts[1].strip() if len(parts) == 2 else markdown_text


def _extract_items(payload):
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    for key in ("medias", "items", "list", "archives", "articles"):
        value = payload.get(key)
        if isinstance(value, list):
            return value
    data = payload.get("data")
    if isinstance(data, dict):
        return _extract_items(data)
    return []


async def _build_focus(cover="", avatar=""):
    return {
        "cover": await get_image_focus_color(cover or "") if cover else None,
        "avatar": await get_image_focus_color(avatar or "") if avatar else None,
    }


async def get_favorite_list_info(media_id=None, favorite_type="video", group_id=None):
    try:
        service_log(
            logger,
            "info",
            "fetch-favorite-list",
            mediaId=media_id,
            favoriteType=favorite_type,
            groupId=group_id,
        )
        credential = load_credential(group_id)
        type_map = {
            "video": favorite_list.FavoriteListType.VIDEO,
            "article": favorite_list.FavoriteListType.ARTICLE,
            "cheese": favorite_list.FavoriteListType.CHEESE,
        }
        type_label_map = {
            "video": "视频收藏夹",
            "article": "专栏收藏夹",
            "cheese": "课程收藏夹",
        }
        favorite_type = favorite_type if favorite_type in type_map else "video"
        media_id_str = str(media_id).strip() if media_id not in (None, "", 0, "0") else ""
        media_id_int = int(media_id_str) if media_id_str and re.fullmatch(r"\d+", media_id_str) else None
        favorite_obj = favorite_list.FavoriteList(
            type_map[favorite_type],
            media_id=media_id_int,
            credential=credential,
        )

        info = {}
        if favorite_type == "video" and media_id_int:
            try:
                info = await favorite_obj.get_info()
            except Exception:
                info = {}

        content = await favorite_obj.get_content(page=1)
        items = _extract_items(content)
        first_item = items[0] if items else {}
        upper = info.get("upper") if isinstance(info.get("upper"), dict) else {}

        cover = _coalesce(
            info.get("cover"),
            first_item.get("cover"),
            first_item.get("pic"),
            first_item.get("image_url"),
        ) or ""
        owner_face = _coalesce(upper.get("face"), info.get("cover")) or ""
        owner_name = _coalesce(upper.get("name"), upper.get("uname"), "我的收藏")
        item_count = _coalesce(info.get("media_count"), info.get("count"), len(items)) or 0
        title = _coalesce(info.get("title"), type_label_map[favorite_type], f"收藏夹 {media_id_int or ''}".strip())
        desc = _coalesce(info.get("intro"), info.get("desc"), first_item.get("title"), title)

        return {
            "status": "success",
            "type": "favorite_list",
            "data": {
                "genericCard": True,
                "title": title,
                "subtitle": type_label_map[favorite_type],
                "desc": _truncate_text(desc),
                "cover": cover,
                "cover_class": "video",
                "owner": {"name": owner_name, "face": owner_face},
                "stats": [{"label": "内容", "value": item_count}],
                "focus": await _build_focus(cover, owner_face),
                "favorite_type": favorite_type,
                "media_id": media_id_int,
            },
        }
    except Exception as e:
        service_log(logger, "error", "fetch-favorite-list-failed", mediaId=media_id, favoriteType=favorite_type, error=str(e))
        return {"status": "error", "message": str(e)}


async def get_audio_info(auid, group_id=None):
    try:
        service_log(logger, "info", "fetch-audio", auid=auid, groupId=group_id)
        credential = load_credential(group_id)
        audio_obj = audio.Audio(int(auid), credential=credential)
        info = await audio_obj.get_info()
        author = _coalesce(info.get("author"), info.get("uname"), info.get("up_name"), info.get("uname"))
        cover = _coalesce(info.get("cover"), info.get("cover_url"), info.get("coverUrl")) or ""
        duration = _coalesce(info.get("duration"), info.get("time"))
        play = _coalesce(
            (info.get("statistic") or {}).get("play"),
            info.get("play"),
        )
        title = _coalesce(info.get("title"), f"音频 AU{auid}")
        intro = _coalesce(info.get("intro"), info.get("desc"), info.get("lyric"), title)
        subtitle_parts = ["音频"]
        if duration:
            subtitle_parts.append(f"时长 {duration}s")

        return {
            "status": "success",
            "type": "audio",
            "data": {
                "genericCard": True,
                "title": title,
                "subtitle": " · ".join(subtitle_parts),
                "desc": _truncate_text(intro),
                "cover": cover,
                "cover_class": "video",
                "owner": {"name": author or "Bilibili 音频", "face": ""},
                "stats": [{"label": "播放", "value": play or 0}],
                "focus": await _build_focus(cover, ""),
                "raw": info,
            },
        }
    except Exception as e:
        service_log(logger, "error", "fetch-audio-failed", auid=auid, error=str(e))
        return {"status": "error", "message": str(e)}


async def get_audio_list_info(amid, group_id=None):
    try:
        service_log(logger, "info", "fetch-audio-list", amid=amid, groupId=group_id)
        credential = load_credential(group_id)
        list_obj = audio.AudioList(int(amid), credential=credential)
        info = await list_obj.get_info()
        songs = await list_obj.get_song_list()
        song_items = _extract_items(songs)
        cover = _coalesce(info.get("cover"), info.get("cover_url"), info.get("coverUrl")) or ""
        title = _coalesce(info.get("title"), info.get("name"), f"歌单 AM{amid}")
        intro = _coalesce(info.get("intro"), info.get("desc"), title)
        song_count = _coalesce(info.get("song_count"), info.get("count"), len(song_items)) or 0

        return {
            "status": "success",
            "type": "audio_list",
            "data": {
                "genericCard": True,
                "title": title,
                "subtitle": "歌单",
                "desc": _truncate_text(intro),
                "cover": cover,
                "cover_class": "video",
                "owner": {"name": _coalesce(info.get("uname"), info.get("author"), "Bilibili 音频"), "face": ""},
                "stats": [{"label": "曲目", "value": song_count}],
                "focus": await _build_focus(cover, ""),
                "raw": info,
            },
        }
    except Exception as e:
        service_log(logger, "error", "fetch-audio-list-failed", amid=amid, error=str(e))
        return {"status": "error", "message": str(e)}


async def get_topic_info(topic_id, group_id=None):
    try:
        service_log(logger, "info", "fetch-topic", topicId=topic_id, groupId=group_id)
        credential = load_credential(group_id)
        topic_obj = topic.Topic(int(topic_id), credential=credential)
        info = await topic_obj.get_info()
        cards = await topic_obj.get_cards(ps=1)
        card_items = _extract_items(cards)
        title = _coalesce(info.get("name"), info.get("topic_name"), f"话题 {topic_id}")
        desc = _coalesce(info.get("description"), info.get("desc"), info.get("share_desc"), title)
        cover = _coalesce(info.get("icon"), info.get("img"), info.get("image"), info.get("cover")) or ""
        view_count = _coalesce(info.get("view"), info.get("view_count"), info.get("discuss"), len(card_items)) or 0

        return {
            "status": "success",
            "type": "topic",
            "data": {
                "genericCard": True,
                "title": title,
                "subtitle": "话题",
                "desc": _truncate_text(desc),
                "cover": cover,
                "cover_class": "video",
                "owner": {"name": "Bilibili 话题", "face": ""},
                "stats": [{"label": "内容", "value": view_count}],
                "focus": await _build_focus(cover, ""),
                "raw": info,
            },
        }
    except Exception as e:
        service_log(logger, "error", "fetch-topic-failed", topicId=topic_id, error=str(e))
        return {"status": "error", "message": str(e)}


async def get_channel_series_info(uid, series_id, series_type="series", group_id=None):
    try:
        service_log(logger, "info", "fetch-channel-series", uid=uid, seriesId=series_id, seriesType=series_type, groupId=group_id)
        credential = load_credential(group_id)
        type_enum = (
            channel_series.ChannelSeriesType.SEASON
            if str(series_type) == "season"
            else channel_series.ChannelSeriesType.SERIES
        )
        channel_obj = channel_series.ChannelSeries(
            uid=int(uid) if uid not in (None, "", -1, "-1") else -1,
            type_=type_enum,
            id_=int(series_id),
            credential=credential,
        )
        meta = await channel_obj.get_meta()
        videos = await channel_obj.get_videos(pn=1, ps=1)
        archives = _extract_items(videos)
        first_item = archives[0] if archives else {}
        title = _coalesce(meta.get("name"), meta.get("title"), meta.get("series_name"), f"合集 {series_id}")
        desc = _coalesce(meta.get("description"), meta.get("intro"), first_item.get("title"), title)
        cover = _coalesce(meta.get("cover"), meta.get("image"), first_item.get("cover"), first_item.get("pic")) or ""
        owner_name = _coalesce(
            (meta.get("upper") or {}).get("name"),
            meta.get("author"),
            meta.get("mid") and f"UP {meta.get('mid')}",
        ) or "Bilibili 合集"
        total = _coalesce(meta.get("total"), meta.get("count"), len(archives)) or 0

        return {
            "status": "success",
            "type": "channel_series",
            "data": {
                "genericCard": True,
                "title": title,
                "subtitle": "合集" if type_enum == channel_series.ChannelSeriesType.SEASON else "列表",
                "desc": _truncate_text(desc),
                "cover": cover,
                "cover_class": "video",
                "owner": {"name": owner_name, "face": ""},
                "stats": [{"label": "视频", "value": total}],
                "focus": await _build_focus(cover, ""),
                "raw": meta,
            },
        }
    except Exception as e:
        service_log(logger, "error", "fetch-channel-series-failed", uid=uid, seriesId=series_id, error=str(e))
        return {"status": "error", "message": str(e)}


async def get_article_list_info(rlid, group_id=None):
    try:
        service_log(logger, "info", "fetch-article-list", rlid=rlid, groupId=group_id)
        credential = load_credential(group_id)
        article_list_obj = article.ArticleList(int(rlid), credential=credential)
        content = await article_list_obj.get_content()
        items = _extract_items(content)
        first_item = items[0] if items else {}
        title = _coalesce(
            (content.get("readlist") or {}).get("title") if isinstance(content, dict) else None,
            content.get("title") if isinstance(content, dict) else None,
            f"文集 RL{rlid}",
        )
        desc = _coalesce(
            (content.get("readlist") or {}).get("summary") if isinstance(content, dict) else None,
            first_item.get("summary"),
            first_item.get("title"),
            title,
        )
        cover = _coalesce(first_item.get("banner_url"), first_item.get("image_url"), first_item.get("cover")) or ""
        author_name = _coalesce(first_item.get("author_name"), first_item.get("author")) or "Bilibili 专栏"
        item_count = len(items)

        return {
            "status": "success",
            "type": "article_list",
            "data": {
                "genericCard": True,
                "title": title,
                "subtitle": "专栏文集",
                "desc": _truncate_text(desc),
                "cover": cover,
                "cover_class": "article",
                "owner": {"name": author_name, "face": ""},
                "stats": [{"label": "文章", "value": item_count}],
                "focus": await _build_focus(cover, ""),
                "raw": content,
            },
        }
    except Exception as e:
        service_log(logger, "error", "fetch-article-list-failed", rlid=rlid, error=str(e))
        return {"status": "error", "message": str(e)}


async def get_note_info(cvid, group_id=None):
    try:
        service_log(logger, "info", "fetch-note", cvid=cvid, groupId=group_id)
        credential = load_credential(group_id)
        note_obj = note.Note(cvid=int(cvid), note_type=note.NoteType.PUBLIC, credential=credential)
        info = await note_obj.get_info()

        try:
            await note_obj.fetch_content()
            markdown_text = note_obj.markdown()
            summary = _strip_front_matter(markdown_text)
        except Exception:
            summary = info.get("summary") or info.get("content") or ""

        try:
            images = await note_obj.get_images_raw_info()
        except Exception:
            images = []

        first_image = images[0] if images else {}
        cover = _coalesce(first_image.get("url"), info.get("banner_url"), info.get("image_url")) or ""
        title = _coalesce(info.get("title"), f"笔记 cv{cvid}")
        author_name = _coalesce(info.get("author_name"), info.get("uname"), info.get("mid") and f"UP {info.get('mid')}") or "Bilibili 笔记"

        return {
            "status": "success",
            "type": "note",
            "data": {
                "genericCard": True,
                "title": title,
                "subtitle": "笔记",
                "desc": _truncate_text(summary),
                "cover": cover,
                "cover_class": "article",
                "owner": {"name": author_name, "face": ""},
                "stats": [{"label": "图片", "value": len(images)}],
                "focus": await _build_focus(cover, ""),
                "raw": info,
            },
        }
    except Exception as e:
        service_log(logger, "error", "fetch-note-failed", cvid=cvid, error=str(e))
        return {"status": "error", "message": str(e)}


async def get_cheese_video_info(ep_id=None, season_id=None, group_id=None):
    try:
        service_log(logger, "info", "fetch-cheese-video", epId=ep_id, seasonId=season_id, groupId=group_id)
        credential = load_credential(group_id)
        if ep_id not in (None, "", 0, "0"):
            video_obj = cheese.CheeseVideo(int(ep_id), credential=credential)
        elif season_id not in (None, "", 0, "0"):
            course_obj = cheese.CheeseList(season_id=int(season_id), credential=credential)
            raw_list = await course_obj.get_list_raw()
            items = raw_list.get("items") or []
            if not items:
                return {"status": "error", "message": "课程暂无可用视频"}
            video_obj = cheese.CheeseVideo(int(items[0]["id"]), credential=credential)
        else:
            return {"status": "error", "message": "缺少课程参数"}

        meta = await video_obj.get_meta()
        course_obj = await video_obj.get_cheese()
        course_meta = await course_obj.get_meta()
        title = _coalesce(meta.get("title"), meta.get("share_sub_title"), f"课程 EP{video_obj.get_epid()}")
        course_title = _coalesce(course_meta.get("title"), course_meta.get("season_title"), "Bilibili 课程")
        desc = _coalesce(meta.get("subtitle"), course_meta.get("subtitle"), course_meta.get("brief"), title)
        cover = _coalesce(meta.get("cover"), course_meta.get("cover")) or ""

        return {
            "status": "success",
            "type": "cheese_video",
            "data": {
                "genericCard": True,
                "title": title,
                "subtitle": course_title,
                "desc": _truncate_text(desc),
                "cover": cover,
                "cover_class": "video",
                "owner": {"name": course_title, "face": ""},
                "stats": [{"label": "课程", "value": course_meta.get("episode_num") or 0}],
                "focus": await _build_focus(cover, ""),
                "raw": meta,
            },
        }
    except Exception as e:
        service_log(logger, "error", "fetch-cheese-video-failed", epId=ep_id, seasonId=season_id, error=str(e))
        return {"status": "error", "message": str(e)}


async def get_interactive_video_info(bvid, group_id=None):
    try:
        service_log(logger, "info", "fetch-interactive-video", bvid=bvid, groupId=group_id)
        credential = load_credential(group_id)
        video_obj = interactive_video.InteractiveVideo(str(bvid), credential=credential)
        info = await video_obj.get_info()
        owner = info.get("owner") or {}
        cover = info.get("pic") or ""
        title = _coalesce(info.get("title"), f"互动视频 {bvid}")
        desc = _coalesce(info.get("desc"), title)
        return {
            "status": "success",
            "type": "interactive_video",
            "data": {
                **info,
                "focus": await _build_focus(cover, owner.get("face") or ""),
            },
        }
    except Exception as e:
        service_log(logger, "error", "fetch-interactive-video-failed", bvid=bvid, error=str(e))
        return {"status": "error", "message": str(e)}
