#!/usr/bin/env python3
"""Clean up auto-tag-based image.for.* tags from cover images in the Toxik database."""

import sqlite3
import sys

DB = "/home/coding/git/toxik/data/IF.db"
AUTO_PREFIXES = ("type:", "ext:", "Format.", "home.", "mnt.", "AI.")

def main():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    try:
        cur.execute("BEGIN")

        cur.execute("""
            SELECT t.id, t.full_tag
            FROM tags t
            WHERE t.full_tag LIKE 'image.for.%'
            ORDER BY t.full_tag
        """)
        all_if_tags = cur.fetchall()

        # Separate into auto-tag and non-auto-tag
        auto_tag_ids = []
        kept_tags = []
        for row in all_if_tags:
            suffix = row["full_tag"][len("image.for."):]
            if suffix.startswith(AUTO_PREFIXES):
                auto_tag_ids.append(row["id"])
            else:
                kept_tags.append(row["full_tag"])

        if not auto_tag_ids:
            print("No auto-tag-based image.for.* tags found. Nothing to clean up.")
            conn.commit()
            return

        # Find cover images (media_type = 'image') that have any of these auto tags
        placeholders = ",".join("?" for _ in auto_tag_ids)
        cur.execute(f"""
            SELECT DISTINCT m.id, m.filename, m.filepath
            FROM media m
            JOIN media_tags mt ON m.id = mt.media_id
            WHERE m.media_type = 'image'
              AND mt.tag_id IN ({placeholders})
            ORDER BY m.id
        """, auto_tag_ids)
        affected_media = cur.fetchall()

        if not affected_media:
            print("No cover images have auto-tag-based image.for.* tags. Nothing to clean up.")
            conn.commit()
            return

        # For each affected media, find the auto-tag-based image.for.* tags to remove
        total_deleted = 0
        for med in affected_media:
            mid = med["id"]
            cur.execute(f"""
                SELECT t.id, t.full_tag
                FROM media_tags mt
                JOIN tags t ON mt.tag_id = t.id
                WHERE mt.media_id = ?
                  AND mt.tag_id IN ({placeholders})
                ORDER BY t.full_tag
            """, [mid] + auto_tag_ids)
            tags_to_remove = cur.fetchall()

            for tag_row in tags_to_remove:
                print(f"DELETE media_tags: media={mid} ({med['filename']}) -> tag='{tag_row['full_tag']}' (id={tag_row['id']})")
                cur.execute(
                    "DELETE FROM media_tags WHERE media_id = ? AND tag_id = ?",
                    (mid, tag_row["id"])
                )
                total_deleted += 1

        conn.commit()
        print(f"\nDone. Deleted {total_deleted} media_tags row(s) from {len(affected_media)} cover image(s).")
        print(f"Kept image.for.* tags: {', '.join(kept_tags)}")
        print(f"Removed auto-tag prefixes: {', '.join(str(p) for p in AUTO_PREFIXES)}")

    except Exception as e:
        conn.rollback()
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        conn.close()

if __name__ == "__main__":
    main()
