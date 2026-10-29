import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { Command, CommandContext } from './types.js';
import { MAIN_SPEAKER_UUIDS } from '../tts/speakers.js';
import { policyExcerpt, termsUrl } from '../tts/policy.js';
import { downloadLibrary } from '../tts/library.js';
import type { DownloadableLibrary, Speaker } from '../tts/voicevox.js';

const unsupported =
  'このエンジンは音声ライブラリの追加に対応していません。エンジンを更新してください';
const builtIn = (uuid: string) => (MAIN_SPEAKER_UUIDS as readonly string[]).includes(uuid);
const selectable = (context: CommandContext, id: string) =>
  new Set<string>([...MAIN_SPEAKER_UUIDS, ...context.store.enabledSpeakers(id)]);
const buttons = (disabled = false) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('install')
      .setLabel('規約を確認してインストール')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('cancel')
      .setLabel('キャンセル')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );

export const speaker: Command = {
  data: new SlashCommandBuilder()
    .setName('speaker')
    .setDescription('キャラを管理します')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('install')
        .setDescription('規約を確認してキャラを有効化します')
        .addStringOption((o) =>
          o.setName('speaker').setDescription('キャラ').setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('uninstall')
        .setDescription('キャラを無効化します')
        .addStringOption((o) =>
          o.setName('speaker').setDescription('キャラ').setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((s) => s.setName('list').setDescription('キャラの導入状況を表示します')),
  async autocomplete(interaction, context) {
    if (
      !interaction.guildId ||
      !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    ) {
      await interaction.respond([]);
      return;
    }
    const id = interaction.guildId;
    const query = interaction.options.getFocused().trim().toLocaleLowerCase('ja');
    const uninstall = interaction.options.getSubcommand() === 'uninstall';
    const installed = new Set(context.store.speakerInstalls(id).map((s) => s.speakerUuid));
    const enabled = selectable(context, id);
    const choices = (await context.engine.speakers())
      .filter((s) =>
        uninstall
          ? installed.has(s.speaker_uuid) && !builtIn(s.speaker_uuid)
          : !enabled.has(s.speaker_uuid),
      )
      .map((s) => ({ name: s.name, value: s.speaker_uuid }));
    if (!uninstall && (await context.engine.engineManifest()).supported_features.manage_library) {
      const libraries = await context.engine.downloadableLibraries();
      const existing = await context.engine.installedLibraries();
      choices.push(
        ...libraries
          .filter((l) => !existing[l.uuid])
          .map((l) => ({ name: `音声ライブラリ: ${l.name}`, value: `lib:${l.uuid}` })),
      );
    }
    await interaction.respond(
      choices
        .filter((c) => c.name.toLocaleLowerCase('ja').includes(query))
        .slice(0, 25)
        .map((c) => ({ ...c, name: c.name.slice(0, 100) })),
    );
  },
  async execute(interaction, context) {
    if (
      !interaction.guildId ||
      !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    ) {
      await interaction.reply({
        content: interaction.guildId
          ? '「サーバー管理」権限が必要です'
          : 'サーバー内で実行してください',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const id = interaction.guildId;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const sub = interaction.options.getSubcommand();
    const speakers = await context.engine.speakers();
    const enabled = selectable(context, id);
    if (sub === 'list') {
      const installs = context.store.speakerInstalls(id);
      const names = new Map(speakers.map((s) => [s.speaker_uuid, s.name]));
      const lines = [
        `標準キャラ: ${
          speakers
            .filter((s) => builtIn(s.speaker_uuid))
            .map((s) => s.name)
            .join('、') || 'なし'
        }`,
        ...installs.map(
          (s) =>
            `${names.get(s.speakerUuid) ?? s.speakerUuid} — 導入者: <@${s.installedBy}> / ${s.installedAt} UTC`,
        ),
        `追加可能: ${speakers.filter((s) => !enabled.has(s.speaker_uuid)).length} キャラ`,
      ];
      const pages: string[] = [];
      for (const line of lines) {
        if (!pages.length || pages[pages.length - 1].length + line.length + 1 > 3800)
          pages.push(line);
        else pages[pages.length - 1] += `\n${line}`;
      }
      for (const [i, page] of pages.entries()) {
        const message = {
          embeds: [new EmbedBuilder().setTitle('キャラの導入状況').setDescription(page)],
          allowedMentions: { parse: [] as never[] },
        };
        if (i === 0) await interaction.editReply(message);
        else await interaction.followUp({ ...message, flags: MessageFlags.Ephemeral });
      }
      return;
    }
    const value = interaction.options.getString('speaker', true);
    const character = speakers.find((s) => s.speaker_uuid === value);
    const notice = async (content: string) => {
      try {
        const channel = interaction.channel;
        if (!channel?.isSendable()) throw new Error('送信先がありません');
        await channel.send({ content, allowedMentions: { parse: [] } });
        return '';
      } catch (error) {
        context.logger.warn({ err: error }, 'キャラ変更の公開通知に失敗しました');
        return '\n公開通知を送信できませんでした。チャンネルの送信権限を確認してください';
      }
    };
    if (sub === 'uninstall') {
      if (builtIn(value)) {
        await interaction.editReply('標準キャラはアンインストールできません');
        return;
      }
      if (!context.store.speakerInstalls(id).some((s) => s.speakerUuid === value)) {
        await interaction.editReply('このサーバーにはインストールされていません');
        return;
      }
      context.store.disableSpeaker(id, value);
      const affected = context.store.enabledSpeakers(id).includes(value)
        ? 0
        : context.store.countStyleUsers(id, character?.styles.map((s) => s.id) ?? []);
      const content = `${character?.name ?? value} をアンインストールしました`;
      await interaction.editReply(
        `${content}\n保存話者が利用不可になるユーザー: ${affected} 人（既定話者へフォールバックします）${await notice(content)}`,
      );
      return;
    }
    const libraryId = value.startsWith('lib:') ? value.slice(4) : undefined;
    let library: DownloadableLibrary | undefined;
    if (libraryId) {
      if (!(await context.engine.engineManifest()).supported_features.manage_library) {
        await interaction.editReply(unsupported);
        return;
      }
      library = (await context.engine.downloadableLibraries()).find((l) => l.uuid === libraryId);
      if (!library || (await context.engine.installedLibraries())[libraryId]) {
        await interaction.editReply('指定されたライブラリは追加できません');
        return;
      }
    } else if (!character || enabled.has(value)) {
      await interaction.editReply('指定されたキャラは追加できません。候補から選択してください');
      return;
    }
    const name = character?.name ?? library!.name;
    const policy = character
      ? (await context.engine.speakerInfo(value)).policy
      : (library!.policy ??
        library!.terms_of_service ??
        'このエンジンはライブラリの規約情報を提供していません。配布元の利用規約とクレジット表記を確認してから続行してください。');
    if (!policy) {
      await interaction.editReply(
        '利用規約を取得できません。エンジン側のライブラリ情報を確認してください',
      );
      return;
    }
    const message = await interaction.editReply({
      content: `${name}\nVOICEVOX:${name}\n${policyExcerpt(policy)}\n${termsUrl(policy) ?? (library ? `配布元: ${library.download_url}` : '規約 URL はありません。上記の規約を確認してください')}\nこのキャラをサーバーで利用可能にします。`,
      components: [buttons()],
      allowedMentions: { parse: [] },
    });
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60_000,
    });
    let handled = false;
    const fail = async (error: unknown) => {
      context.logger.warn({ err: error }, 'キャラのインストールに失敗しました');
      await interaction
        .editReply({
          content: 'インストールに失敗しました。エンジンと接続状態を確認してください',
          components: [buttons(true)],
        })
        .catch((err: unknown) => context.logger.warn({ err }, '確認画面を更新できませんでした'));
    };
    collector.on('collect', (button) => {
      const install = async () => {
        if (button.user.id !== interaction.user.id) {
          await button.reply({
            content: '実行した管理者だけが操作できます',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        if (handled) return;
        handled = true;
        collector.stop('handled');
        await button.deferUpdate();
        if (button.customId === 'cancel') {
          await interaction.editReply({
            content: 'キャンセルしました',
            components: [buttons(true)],
          });
          return;
        }
        if (!button.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          await interaction.editReply({
            content: '「サーバー管理」権限が必要です',
            components: [buttons(true)],
          });
          return;
        }
        let targets: Speaker[] = character ? [character] : [];
        if (library) {
          await context.engine.installLibrary(
            library.uuid,
            await downloadLibrary(library.download_url),
          );
          targets = (await context.engine.refreshSpeakers()).filter(
            (s) => !speakers.some((old) => old.speaker_uuid === s.speaker_uuid),
          );
          if (!targets.length) throw new Error('追加されたキャラが見つかりません');
        }
        const failed: number[] = [];
        for (const target of targets) {
          for (const style of target.styles) {
            try {
              await context.engine.initializeSpeaker(style.id, { skipReinit: true });
            } catch (error) {
              failed.push(style.id);
              context.logger.warn(
                { err: error, styleId: style.id },
                'スタイルの事前ロードに失敗しました',
              );
            }
          }
          context.store.enableSpeaker(id, target.speaker_uuid, interaction.user.id);
        }
        const publicText = targets
          .map(
            (s) =>
              `${s.name} をインストールしました（VOICEVOX:${s.name}）。/voice set で選択できます`,
          )
          .join('\n');
        const warning = await notice(publicText);
        await interaction.editReply({
          content: `${name} をインストールしました${failed.length ? `\n一部スタイルの事前ロードに失敗しました（ID: ${failed.join('、')}）。利用時に再ロードします` : ''}${warning}`,
          components: [buttons(true)],
          allowedMentions: { parse: [] },
        });
      };
      void (context.lifecycle ? context.lifecycle.run(install) : install()).catch(fail);
    });
    collector.on('end', () => {
      if (handled) return;
      handled = true;
      void interaction
        .editReply({ content: 'タイムアウトしました', components: [buttons(true)] })
        .catch(fail);
    });
  },
};
