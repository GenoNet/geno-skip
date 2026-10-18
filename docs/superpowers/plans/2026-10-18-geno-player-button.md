# Geno Skip プレーヤーボタン改善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 動画プレーヤー下部の geno ちゃんの顔ボタンから加速できるようにし、既存のキー・ポップアップ操作と状態復元の信頼性を改善する。

**Architecture:** Manifest V3・ビルド不要の構成を保つ。`content.js` が加速と設定・入力・状態通知を管理し、新しい `player-button.js` がプレーヤーへのボタン設置を担当する。顔ボタン・キー・ポップアップは同じ加速処理を呼び出す。

**Tech Stack:** JavaScript、Chrome Extensions API、HTML/CSS。検証用のみ Node.js 24、`node:test`、`playwright-core@1.57.0`、Chromium を使う。

**Spec:** 本書「提案仕様」。既存の操作を拡張する変更として、設計と実装計画を一つにまとめる。ユーザーの「まずは plan」という依頼に対するレビュー用提案であり、実装はまだ開始しない。

## Global Constraints

- 既定は16倍速・3,000ms後に自動解除。Sキーとポップアップの Go!/Stop! を維持する。
- 顔画像はユーザー添付画像を使い、元画像の透過と縦横比を保持する。
- 製品への実行時依存、ビルド工程、外部API、AIサービス、アクセス解析を追加しない。
- 保存済み設定名 `accelerationKey` / `videoUrls` と既存メッセージ型を維持する。
- 今回は既存チェックアウトで作業する。環境セットアップ時に作った補助ファイルは製品に依存させない。
- Chromium の管理ポリシーは変更・回避しない。模擬APIでの検証と実拡張検証を区別する。

## 調査結果と参考箇所

- 現在の `content.js` はページ内のすべての動画を一括加速し、解除時は再生速度を1、ミュートをfalseに固定している。音量0も `|| 1` により1へ戻る。
- ページクリックによる解除でタイマーが残り、`ACCEL_STATE` が通知されない。キーリピートの除外もない。
- `hostname.includes(pattern)` は `notyoutube.com` などを誤一致させる。ポップアップ操作には対応サイトの判定がない。
- DOM全体の変更ごとに全動画を再検索している。設定保存後はタブ更新が必要で、メッセージ送信失敗の表示がない。
- 参考: [youtube-ambilight](https://github.com/WesselKroos/youtube-ambilight)、調査コミット `18d17188e5562e5ee913f005192d30c9a60be078`。
- 参考実装の `src/scripts/libs/ambientlight.js` は `.ytp-right-controls` と `.ytp-chrome-controls > *:last-child` を探索する。`src/scripts/libs/settings.js` は `ytp-button` を作り、既存コントロール群へ挿入する。`src/scripts/content-main.js` は `yt-navigate-finish` とDOM監視で遷移に追従する。
- 同じプレーヤーへの組み込み方を参考にし、geno用に独自実装する。参考コードを転用する場合は、その箇所とライセンス表記を別途確認する。

## 提案仕様

### 1. 顔ボタンと対象サイト

- YouTube はプレーヤー下部右側、設定ボタン付近に顔ボタンを一つ追加する。右側の操作群を優先し、上記の代替セレクターにも対応する。
- 添付の顔画像を `assets/geno-face.png` に保存する。24px相当の顔を中央に表示し、クリック領域は周囲のボタンに合わせる。画像取得経路が利用できない場合は既存 `icon48.png` で一時確認し、画像反映前に完成扱いにしない。
- 通常時は顔だけ、加速中は枠色と小さな「16×」表示を付ける。色だけに頼らず、ツールチップと `aria-pressed` も更新する。
- 1回クリックで16倍速＋ミュート、再クリックまたは3秒経過で開始直前の状態に戻す。Sキー・Go!/Stop! と同期する。
- ニコニコ・ユーザー追加サイトは対応を維持する。専用操作列を確実に特定できないサイトでは、表示中の動画の直下に小さなボタン行を置く。配置できる動画がないページには表示しない。
- YouTubeの通常・シアター・全画面表示、連続視聴、プレーヤー再生成に追従する。重複設置しない。他拡張が置いたボタンを移動・削除しない。
- 初期対象はデスクトップのHTML動画プレーヤー。Shorts固有UI、モバイル専用UI、ブラウザーのネイティブPiPへのボタン追加は別の変更とする。

### 2. 加速と復元

- 顔ボタンは所属するプレーヤーの動画を操作する。キー・ポップアップは、加速中ならその動画を解除し、停止中なら表示中かつ再生中の動画を優先して選ぶ。同順位では表示面積最大の動画を選ぶ。
- 1文書につき同時に加速する動画は1つ。別プレーヤーのボタンで開始する場合は、先に元の動画を復元する。背景のプレビュー動画は一括加速しない。
- 開始時の `playbackRate`、`volume`、`muted` を保存し、解除時にそのまま戻す。0音量、開始前からミュート、1.5倍速なども保持する。
- 全解除経路を `stopAcceleration(reason)` に集約し、タイマー解除、復元、状態通知、顔ボタン表示更新を必ず一緒に行う。
- 既存のページクリック解除を維持する。ただし顔ボタン自身のクリックで即解除しない。キー長押し・IME変換中・修飾キー併用・入力欄・編集可能要素では加速キーを無視する。
- 動画終了・削除・別ソースへの切替・対象サイト無効化では解除する。プレーヤー再生成後の新動画には自動で加速を引き継がない。
- 動画なし／速度設定拒否では有効状態にせず、ポップアップに理由を返す。

### 3. 設定と負荷

- サイト入力は裸のホスト名またはHTTP(S) URLを受け付け、ホスト名へ正規化する。重複を除き、無効な行は保存せず行番号を表示する。部分文字列やワイルドカードは使わない。
- `hostname === domain || hostname.endsWith('.' + domain)` で照合する。既存の正しいホスト名設定はそのまま使う。保存済みの無効値は適用せず、編集画面で修正できるようにする。
- `chrome.storage.onChanged` で設定を反映し、通常の設定変更ではタブ更新を不要にする。空のサイト一覧は「対象なし」として尊重する。
- 監視は対象サイトだけで開始する。初回に候補を探索し、その後は変更ノードを絞り、同一フレーム内の再探索をまとめる。定期ポーリングは行わない。
- ポップアップの Go!/Stop! は対応タブ・動画がない場合に状態を説明する。通知は現在のタブからのものだけ反映する。
- 未使用の `tabs` / `scripting` 権限は実際のAPI使用条件を確認して削除する。ユーザーが任意の対応サイトを追加するため、既存のHTTP(S)コンテンツスクリプト対象範囲は維持する。

### 4. 今回の改善範囲

ボタン追加と上記の信頼性・負荷・設定改善を一度に検証する。倍率・秒数の新しい設定、広告の自動検出、広告自動クリックは今回追加しない。

## Review Focus

- 顔ボタンクリックのバブリングで加速が即解除されないこと → Task 2。
- 0音量・既存ミュート・任意速度を壊さず、古いタイマーが次の加速を解除しないこと → Task 1。
- YouTube内遷移・コントロール交換・DOMの大量更新でボタンや監視が増殖しないこと → Task 2 / 4。
- 複数動画・無動画・動画削除・再生速度拒否で別の動画や状態表示を壊さないこと → Task 1 / 3。
- 似たドメイン・壊れた保存値・別タブ通知・受信先のないタブを正しく扱うこと → Task 3。

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `content.js`（変更） | 設定読込、対象判定、動画選択、加速状態、キー・メッセージ・SPAイベントの統合 |
| `player-button.js`（追加） | 動画に対応する顔ボタンの設置・更新・撤去。`globalThis.GenoPlayerButtons` を公開 |
| `player-button.css`（追加） | geno専用クラスに閉じた見た目・フォーカス・加速表示 |
| `assets/geno-face.png`（追加） | 添付の顔画像 |
| `popup.js` / `popup.html`（変更） | 設定検証、保存・操作エラー、現在のタブとの状態同期 |
| `manifest.json`（変更） | スクリプト順、CSS、顔画像の公開範囲、権限整理 |
| `tests/*.test.cjs` / `tests/helpers/browser.cjs`（追加） | ローカルHTMLによる動画・UI・ポップアップの回帰検証 |
| `package.json` / `package-lock.json` / `.gitignore`（追加） | テスト専用依存とコマンド。製品の実行・配布にはnpmを要求しない |
| `README.md`（変更） | 新しい操作・開発手順・検証上の制限 |

## Task 1: 動画状態の正確な保存・復元

**Files:** Modify `content.js`; Create `tests/content.test.cjs`, `tests/helpers/browser.cjs`, `package.json`, `package-lock.json`, `.gitignore`。

**Interfaces:** `startAcceleration(video: HTMLVideoElement): boolean`、`stopAcceleration(reason: string): void`、`toggleAcceleration(video?: HTMLVideoElement): void`、`getAccelerationState(): { isActive: boolean, reason?: string }`。`content.js` 内で管理し、状態通知は既存 `ACCEL_STATE` を使う。

- [ ] `node:test` と `playwright-core@1.57.0` のテスト環境を用意する。`npm test` はローカルChromiumを使い、`CHROMIUM_EXECUTABLE_PATH` で指定可能にする。Chrome APIだけを代替し、実際のDOMと動画要素で検証する。
- [ ] 開始速度1.5・音量0・ミュートtrueの動画が、加速中は16倍速、解除後は元の値になる失敗テストを書く。
- [ ] 3,000ms自動解除、手動解除直後の再開始、対象動画削除、速度代入拒否、動画なし、複数動画の選択テストを加え、現行コードで失敗することを確認する。
- [ ] 上記インターフェースと単一セッションを実装する。解除はタイマー・クリック・再クリック・動画ライフサイクルで共通化する。
- [ ] キーのrepeat・isComposing・修飾キー・入れ子のcontenteditableを除外するテストと修正を加える。
- [ ] `node --test tests/content.test.cjs` が全件通ることを確認し、変更をコミットする。

## Task 2: 顔ボタンの追加とプレーヤー追従

**Files:** Create `player-button.js`, `player-button.css`, `assets/geno-face.png`, `tests/player-button.test.cjs`; Modify `content.js`, `manifest.json`。

**Interfaces:** `GenoPlayerButtons.mount({root: Element, video: HTMLVideoElement, onToggle: () => void}): { setActive(active: boolean): void, destroy(): void }`。`mount` は同じプレーヤーに対して重複せず、YouTubeの操作列または汎用の動画直下を選ぶ。Task 1の `toggleAcceleration(video)` を呼ぶ。

- [ ] YouTube相当のDOMで、右操作列・代替操作列・遅延生成・コントロール交換・汎用動画直下に各1個設置される失敗テストを書く。他拡張ボタンが残ることも確認する。
- [ ] 顔ボタンの実クリックで16倍速が維持され、再クリックで元に戻ること、Enter/Space操作、`aria-pressed` と状態表示の同期をテストする。
- [ ] 添付画像を取り込み、専用クラスのCSSと `GenoPlayerButtons` を実装する。YouTubeの操作列を優先し、コントロールを作り直した際に古いリスナーを破棄する。
- [ ] `manifest.json` に `player-button.js` → `content.js` の読み込み順とCSSを登録する。顔画像だけを必要なHTTP(S)ページへ `web_accessible_resources` で公開し、他の内部ファイルを公開しない。
- [ ] `yt-navigate-finish`、対象動画のライフサイクル、限定したDOM監視を接続する。自身のUI更新による監視ループを防ぐ。
- [ ] `node --test tests/player-button.test.cjs` が通り、通常・シアター・全画面相当のDOMで画像が欠けずに見えることを確認してコミットする。

## Task 3: 設定即時反映とポップアップ同期

**Files:** Modify `content.js`, `popup.js`, `popup.html`, `manifest.json`; Create `tests/popup.test.cjs`, `tests/settings.test.cjs`。

**Interfaces:** 既存 `TOGGLE_ACCELERATION` / `REQUEST_STATE` の応答 `{ isActive }` を保ち、操作不能時は追加の `reason` を返す。`chrome.storage.onChanged` の設定更新が顔ボタン・キー・ポップアップに反映される。

- [ ] 正規ドメインとサブドメインは有効、`notyoutube.com` / `youtube.com.evil.test` は無効、URL入力はホストへ正規化、無効行は行番号表示、空一覧は対象なしになる失敗テストを書く。
- [ ] 保存済み設定の読込、壊れた値、設定変更時の即時反映、対象除外時の解除をテストして修正する。
- [ ] 動画なし・非対応サイト・`chrome://` ページ・受信先なしの応答をテストする。`chrome.runtime.lastError` を処理し、ポップアップに短い日本語メッセージを表示する。
- [ ] 現在のタブIDを取得し、別タブの `ACCEL_STATE` を無視するテストと修正を加える。タイマー解除・クリック解除で顔ボタンと Go!/Stop! が揃うことを確認する。
- [ ] 未使用権限を整理する。`activeTab` と `storage` で必要操作が行えるかをAPI仕様と実拡張検証で確認し、必要な権限のみ残す。
- [ ] `node --test tests/settings.test.cjs tests/popup.test.cjs` と既存テストが通ることを確認してコミットする。

## Task 4: 統合検証と使い方の更新

**Files:** Modify `README.md`; Create `tests/integration.test.cjs`, `tests/manifest.test.cjs`。

- [ ] ローカルページで「顔ボタン開始 → ポップアップ状態取得 → 3秒後解除」「キー開始 → 顔ボタン解除」「設定変更 → 別動画へのSPA遷移」をテストする。
- [ ] 無関係DOMの更新をまとめて発生させてもボタンが1個であること、動画削除後に状態が解除されること、対象外サイトではボタン・動画監視が動かないことを検証する。時間計測による不安定な速度判定は使わない。
- [ ] manifestから参照するJS・CSS・画像が存在し、読み込み順と公開リソースが仕様どおりであることをテストする。
- [ ] `npm ci`、`npm test`、`node --check content.js`、`node --check player-button.js`、`node --check popup.js` を実行し、実行件数と結果を記録する。
- [ ] 実拡張を読み込める承認済みブラウザーが利用できれば、YouTubeの通常・シアター・全画面・連続遷移とニコニコ、設定保存、背景タブとの分離を手動確認する。提供されていなければ実機確認を未実施として残し、API代替テストの合格と区別する。
- [ ] READMEを顔ボタン・元の速度への復帰・設定即時反映・テスト手順に合わせ、全差分を確認してコミットする。

## 現在の検証制約と完了条件

環境の Chromium は `ExtensionInstallBlocklist: ["*"]` により拡張追加が禁止されている。既存セットアップ時にも読み込み拒否を確認済み。コード・DOM・回帰テストは実施できるが、実拡張の画像公開・Chrome API・サイト統合の最終確認には、拡張の開発読み込みを許可されたブラウザーが必要になる。管理ポリシー変更は計画に含めない。

完了条件は、顔ボタンの配置と16倍速・再クリック・3秒復帰、元の動画状態の保存、既存操作との同期、遷移時の重複防止、設定検証が回帰テストで確認されること。実機確認と添付画像の反映状況は別途明示し、未実施の項目を検証済みと報告しない。

## 実装順とレビュー

Task 1 → Task 2 → Task 3 → Task 4 の順に、このセッションで実装する方法を推奨する。小さな既存拡張で同じ状態管理に依存するため、作業の引き継ぎを増やさず進められる。まず本計画の仕様をレビューしてから実装に移る。
