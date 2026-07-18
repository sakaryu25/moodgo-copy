-- ─── ⑧ 協調フィルタ（この気分で好きな人はこれも）─────────────────────────────
-- 「同じ気分グループで、あるスポットXに反応した人は、他のどのスポットYにも反応しがちか」
-- というアイテム間の共起シグナルで検索結果を薄くブーストする。
--
-- 【重要】このSQLは未適用でも recommend は動作する（協調ブーストが静かに無効化されるだけ）。
--   ・共起の素地は spot_engagement の per-user 行動ログ（device_id 付き）。
--     device_id 列は supabase/funnel-tracking.sql で追加される（それも未適用なら共起は空＝無害）。
--   ・recommend 本体は device_id 付き行を直近6000件だけ読み、サーバー(Node)側で
--     「device × 気分グループ」の basket を組み、ユーザーの過去高評価スポットとの共起を集計する
--     （fetchCoocBaskets / buildCollabBoost）。RPC には依存しない。
--   ・ブーストは learnScore に小さく合成され、上限つき（距離/学習/persona を覆さない）。
--
-- このファイルで行うのは以下だけ:
--   (A) 上記の直近フェッチを速くする索引（任意・性能のみ）。
--   (B) 将来サーバー側集計へ移す場合に使える任意RPC collab_neighbors（現状 recommend は未使用）。

-- (A) 索引: device_id 付き行を created_at 降順で引く読み取りを高速化 ────────────────
--   ※ device_id 列が未作成(funnel-tracking.sql 未適用)の環境では、この索引作成は失敗する。
--     その場合は funnel-tracking.sql を先に流すか、この索引をスキップしてよい（機能は動く）。
create index if not exists idx_spot_engagement_device_created
  on spot_engagement (device_id, created_at desc)
  where device_id is not null;

-- (B) 任意RPC: サーバー側でアンカー集合の共起近縁を返す（現状 recommend は未使用・将来用）──
--   p_anchors : ユーザーが過去に高評価したスポット名（小文字化して渡す想定）
--   p_moods   : 対象の気分グループに属する mood 生文字列の配列（NULL/空なら気分で絞らない）
--   戻り値    : place_name（小文字）と共起スコア（大きいほど近縁）
--   ・行動重み: visited=4 / favorite=3 / share=2 / map_click=2 / detail_view=1
--   ・アンカー自身は除外（既に行った場所は再提案しない）。
create or replace function collab_neighbors(
  p_anchors    text[],
  p_moods      text[] default null,
  result_limit int    default 60
)
returns table (place_name text, cooc numeric)
language sql stable as $$
  with ev as (
    select
      e.device_id,
      lower(btrim(e.place_name)) as nm,
      case e.action
        when 'visited'     then 4
        when 'favorite'    then 3
        when 'share'       then 2
        when 'map_click'   then 2
        when 'detail_view' then 1
        else 0 end as w
    from spot_engagement e
    where e.device_id is not null
      and e.place_name is not null
      and (p_moods is null or array_length(p_moods, 1) is null or e.mood = any(p_moods))
  ),
  -- アンカーに反応した (device) と、その device のアンカー最大反応強度
  anchored as (
    select device_id, max(w) as anchor_w
    from ev
    where nm = any(select lower(btrim(a)) from unnest(p_anchors) a)
    group by device_id
    having max(w) > 0
  )
  select ev.nm as place_name,
         sum(least(a.anchor_w, ev.w))::numeric as cooc
  from ev
  join anchored a on a.device_id = ev.device_id
  where ev.nm <> all(select lower(btrim(x)) from unnest(p_anchors) x)
    and ev.w > 0
  group by ev.nm
  order by cooc desc
  limit result_limit;
$$;
