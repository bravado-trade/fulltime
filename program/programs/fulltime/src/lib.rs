use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("6Aow8DZvpWFPrKYf1tUU2WsSXuFF36iNyh4rJegp62M9");

declare_program!(txoracle);
use txoracle::program::Txoracle;
use txoracle::types::{
    BinaryExpression, Comparison, NDimensionalStrategy, StatPredicate, StatValidationInput,
    TraderPredicate,
};

pub const MAX_LEGS: usize = 5;
pub const MAX_QUESTION_LEN: usize = 96;
/// TxLINE finalisation records carry period == 100 on every proven stat leaf.
/// Requiring it on-chain rejects proofs taken from in-running (mid-game) records.
pub const FINALISED_PERIOD: i32 = 100;
/// After this long past the stake deadline an unsettled market can be voided
/// (abandoned / postponed / coverage-cancelled fixtures). See docs/SETTLEMENT_POLICY.md.
pub const VOID_TIMEOUT_SECS: i64 = 48 * 60 * 60;

#[program]
pub mod fulltime {
    use super::*;

    pub fn create_market(
        ctx: Context<CreateMarket>,
        market_id: u64,
        fixture_id: i64,
        stake_deadline: i64,
        stat_keys: Vec<u32>,
        legs: Vec<Leg>,
        question: String,
    ) -> Result<()> {
        require!(
            !stat_keys.is_empty() && stat_keys.len() <= MAX_LEGS,
            FullTimeError::InvalidLegCount
        );
        require!(!legs.is_empty() && legs.len() <= MAX_LEGS, FullTimeError::InvalidLegCount);
        require!(question.len() <= MAX_QUESTION_LEN, FullTimeError::QuestionTooLong);
        require!(
            stake_deadline > Clock::get()?.unix_timestamp,
            FullTimeError::DeadlineInPast
        );

        // Mirror the oracle's coverage rule: every stat index referenced by at
        // least one leg, and all indexes in range, so settlement can never hit
        // IncompleteStatCoverage at the CPI boundary.
        let mut covered = [false; MAX_LEGS];
        for leg in &legs {
            match leg {
                Leg::Single { index, .. } => {
                    require!((*index as usize) < stat_keys.len(), FullTimeError::LegIndexOutOfRange);
                    covered[*index as usize] = true;
                }
                Leg::Binary { index_a, index_b, .. } => {
                    require!(
                        (*index_a as usize) < stat_keys.len()
                            && (*index_b as usize) < stat_keys.len(),
                        FullTimeError::LegIndexOutOfRange
                    );
                    covered[*index_a as usize] = true;
                    covered[*index_b as usize] = true;
                }
            }
        }
        for i in 0..stat_keys.len() {
            require!(covered[i], FullTimeError::UncoveredStatKey);
        }

        let market = &mut ctx.accounts.market;
        market.creator = ctx.accounts.creator.key();
        market.market_id = market_id;
        market.fixture_id = fixture_id;
        market.stake_deadline = stake_deadline;
        market.stat_keys = stat_keys;
        market.legs = legs;
        market.question = question;
        market.mint = ctx.accounts.mint.key();
        market.yes_total = 0;
        market.no_total = 0;
        market.status = MarketStatus::Open;
        market.settled_at = 0;
        market.bump = ctx.bumps.market;
        Ok(())
    }

    pub fn stake(ctx: Context<Stake>, side: Side, amount: u64) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(market.status == MarketStatus::Open, FullTimeError::MarketNotOpen);
        require!(
            Clock::get()?.unix_timestamp < market.stake_deadline,
            FullTimeError::StakingClosed
        );
        require!(amount > 0, FullTimeError::ZeroAmount);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.staker_token.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.staker.to_account_info(),
                },
            ),
            amount,
        )?;

        let position = &mut ctx.accounts.position;
        position.owner = ctx.accounts.staker.key();
        position.market = market.key();
        position.bump = ctx.bumps.position;
        match side {
            Side::Yes => {
                position.yes_amount = position.yes_amount.checked_add(amount).unwrap();
                market.yes_total = market.yes_total.checked_add(amount).unwrap();
            }
            Side::No => {
                position.no_amount = position.no_amount.checked_add(amount).unwrap();
                market.no_total = market.no_total.checked_add(amount).unwrap();
            }
        }
        Ok(())
    }

    /// Permissionless trustless settlement: anyone may submit the TxLINE Merkle
    /// proof payload. The oracle program verifies the proof against the daily
    /// root anchored on-chain by TxODDS; we verify the payload actually binds
    /// to THIS market (fixture, stat keys, finalised period) and derive the
    /// strategy from the stored legs so a caller can never prove a different
    /// question than the one staked on.
    pub fn settle(ctx: Context<Settle>, payload: StatValidationInput) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(market.status == MarketStatus::Open, FullTimeError::MarketNotOpen);
        require!(
            Clock::get()?.unix_timestamp >= market.stake_deadline,
            FullTimeError::TooEarlyToSettle
        );
        require!(
            payload.fixture_summary.fixture_id == market.fixture_id,
            FullTimeError::FixtureMismatch
        );
        require!(
            payload.stats.len() == market.stat_keys.len(),
            FullTimeError::StatKeysMismatch
        );
        for (i, leaf) in payload.stats.iter().enumerate() {
            require!(
                leaf.stat.key == market.stat_keys[i],
                FullTimeError::StatKeysMismatch
            );
            require!(
                leaf.stat.period == FINALISED_PERIOD,
                FullTimeError::NotFinalised
            );
        }

        let strategy = NDimensionalStrategy {
            geometric_targets: vec![],
            distance_predicate: None,
            discrete_predicates: market
                .legs
                .iter()
                .map(|leg| match leg {
                    Leg::Single { index, threshold, cmp } => StatPredicate::Single {
                        index: *index,
                        predicate: TraderPredicate {
                            threshold: *threshold,
                            comparison: cmp.to_oracle(),
                        },
                    },
                    Leg::Binary { index_a, index_b, add, threshold, cmp } => {
                        StatPredicate::Binary {
                            index_a: *index_a,
                            index_b: *index_b,
                            op: if *add {
                                BinaryExpression::Add
                            } else {
                                BinaryExpression::Subtract
                            },
                            predicate: TraderPredicate {
                                threshold: *threshold,
                                comparison: cmp.to_oracle(),
                            },
                        }
                    }
                })
                .collect(),
        };

        let result = txoracle::cpi::validate_stat_v2(
            CpiContext::new(
                ctx.accounts.oracle_program.key(),
                txoracle::cpi::accounts::ValidateStatV2 {
                    daily_scores_merkle_roots: ctx
                        .accounts
                        .daily_scores_merkle_roots
                        .to_account_info(),
                },
            ),
            payload,
            strategy,
        )?
        .get();

        // If either side of the pool is empty there is no counterparty; treat as
        // void so stakes are simply refunded.
        if market.yes_total == 0 || market.no_total == 0 {
            market.status = MarketStatus::Voided;
        } else {
            market.status = if result {
                MarketStatus::SettledYes
            } else {
                MarketStatus::SettledNo
            };
        }
        market.settled_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let market = &ctx.accounts.market;
        let position = &mut ctx.accounts.position;
        require!(!position.claimed, FullTimeError::AlreadyClaimed);

        let payout: u64 = match market.status {
            MarketStatus::Open => return err!(FullTimeError::MarketNotSettled),
            MarketStatus::Voided => {
                position.yes_amount.checked_add(position.no_amount).unwrap()
            }
            MarketStatus::SettledYes => {
                if position.yes_amount == 0 {
                    0
                } else {
                    (position.yes_amount as u128)
                        .checked_mul((market.yes_total as u128) + (market.no_total as u128))
                        .unwrap()
                        .checked_div(market.yes_total as u128)
                        .unwrap() as u64
                }
            }
            MarketStatus::SettledNo => {
                if position.no_amount == 0 {
                    0
                } else {
                    (position.no_amount as u128)
                        .checked_mul((market.yes_total as u128) + (market.no_total as u128))
                        .unwrap()
                        .checked_div(market.no_total as u128)
                        .unwrap() as u64
                }
            }
        };
        position.claimed = true;
        if payout > 0 {
            let market_id_bytes = market.market_id.to_le_bytes();
            let seeds: &[&[u8]] = &[b"market", market_id_bytes.as_ref(), &[market.bump]];
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.claimer_token.to_account_info(),
                        authority: market.to_account_info(),
                    },
                    &[seeds],
                ),
                payout,
            )?;
        }
        Ok(())
    }

    /// Escape hatch for fixtures that never produce a finalised record
    /// (abandoned, postponed, coverage cancelled): after VOID_TIMEOUT_SECS past
    /// the stake deadline anyone can void, unlocking full refunds via claim.
    pub fn void(ctx: Context<Void>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(market.status == MarketStatus::Open, FullTimeError::MarketNotOpen);
        require!(
            Clock::get()?.unix_timestamp >= market.stake_deadline + VOID_TIMEOUT_SECS,
            FullTimeError::VoidTimeoutNotReached
        );
        market.status = MarketStatus::Voided;
        market.settled_at = Clock::get()?.unix_timestamp;
        Ok(())
    }
}

// ---------- state ----------

#[account]
pub struct Market {
    pub creator: Pubkey,
    pub market_id: u64,
    pub fixture_id: i64,
    pub stake_deadline: i64,
    pub stat_keys: Vec<u32>,
    pub legs: Vec<Leg>,
    pub question: String,
    pub mint: Pubkey,
    pub yes_total: u64,
    pub no_total: u64,
    pub status: MarketStatus,
    pub settled_at: i64,
    pub bump: u8,
}

impl Market {
    pub const SPACE: usize = 8 + 32 + 8 + 8 + 8
        + (4 + MAX_LEGS * 4)
        + (4 + MAX_LEGS * 10)
        + (4 + MAX_QUESTION_LEN)
        + 32 + 8 + 8 + 1 + 8 + 1
        + 64; // headroom
}

#[account]
#[derive(Default)]
pub struct Position {
    pub owner: Pubkey,
    pub market: Pubkey,
    pub yes_amount: u64,
    pub no_amount: u64,
    pub claimed: bool,
    pub bump: u8,
}

impl Position {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 8 + 1 + 1 + 16;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum MarketStatus {
    Open,
    SettledYes,
    SettledNo,
    Voided,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Yes,
    No,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum Leg {
    /// stat[index] <cmp> threshold
    Single { index: u8, threshold: i32, cmp: Cmp },
    /// (stat[index_a] +/- stat[index_b]) <cmp> threshold
    Binary { index_a: u8, index_b: u8, add: bool, threshold: i32, cmp: Cmp },
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Cmp {
    Gt,
    Lt,
    Eq,
}

impl Cmp {
    pub fn to_oracle(self) -> Comparison {
        match self {
            Cmp::Gt => Comparison::GreaterThan,
            Cmp::Lt => Comparison::LessThan,
            Cmp::Eq => Comparison::EqualTo,
        }
    }
}

// ---------- accounts ----------

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init,
        payer = creator,
        space = Market::SPACE,
        seeds = [b"market", market_id.to_le_bytes().as_ref()],
        bump
    )]
    pub market: Account<'info, Market>,
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = market,
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut)]
    pub staker: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(
        init_if_needed,
        payer = staker,
        space = Position::SPACE,
        seeds = [b"position", market.key().as_ref(), staker.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,
    #[account(mut, constraint = staker_token.mint == market.mint)]
    pub staker_token: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = market.mint,
        associated_token::authority = market,
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    /// TxODDS txoracle daily scores Merkle roots PDA for the proof's epoch day.
    /// CHECK: re-derived and validated by the txoracle program during the CPI;
    /// trust comes from the oracle program id constraint below.
    pub daily_scores_merkle_roots: UncheckedAccount<'info>,
    pub oracle_program: Program<'info, Txoracle>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub claimer: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), claimer.key().as_ref()],
        bump = position.bump,
        constraint = position.owner == claimer.key()
    )]
    pub position: Account<'info, Position>,
    #[account(mut, constraint = claimer_token.mint == market.mint)]
    pub claimer_token: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = market.mint,
        associated_token::authority = market,
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Void<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
}

// ---------- errors ----------

#[error_code]
pub enum FullTimeError {
    #[msg("Between 1 and 5 legs/stat keys required")]
    InvalidLegCount,
    #[msg("Question string too long")]
    QuestionTooLong,
    #[msg("Stake deadline must be in the future")]
    DeadlineInPast,
    #[msg("Leg references a stat index out of range")]
    LegIndexOutOfRange,
    #[msg("Every stat key must be covered by at least one leg")]
    UncoveredStatKey,
    #[msg("Market is not open")]
    MarketNotOpen,
    #[msg("Staking window has closed")]
    StakingClosed,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Cannot settle before the stake deadline")]
    TooEarlyToSettle,
    #[msg("Proof payload is for a different fixture")]
    FixtureMismatch,
    #[msg("Proof stats do not match the market's stat keys")]
    StatKeysMismatch,
    #[msg("Proof is not from a finalised record (period != 100)")]
    NotFinalised,
    #[msg("Market not settled yet")]
    MarketNotSettled,
    #[msg("Position already claimed")]
    AlreadyClaimed,
    #[msg("Void timeout not reached")]
    VoidTimeoutNotReached,
}
