#!/usr/bin/env ruby
# frozen_string_literal: true

require "date"
require "optparse"
require "pathname"
require "time"
require "yaml"

class OkfValidator
  RESERVED = %w[index.md log.md].freeze
  LIFECYCLE_STATUSES = %w[draft stable deprecated].freeze
  ACTOR = /\A(?:human:[^\s]+|process:[^\s]+|[^\/\s]+\/[^\/\s]+)\z/
  ISO_DATE = /\A\d{4}-\d{2}-\d{2}\z/

  attr_reader :concept_count, :index_count, :log_count

  def initialize(root:, required_version:, strict:)
    @root = Pathname(root).expand_path
    @required_version = required_version
    @strict = strict
    @errors = []
    @warnings = []
    @concept_count = 0
    @index_count = 0
    @log_count = 0
    @bundle_version = nil
  end

  def validate
    unless @root.directory?
      @errors << "#{@root}: bundle directory does not exist"
      return false
    end

    markdown_files.each do |path|
      case path.basename.to_s
      when "index.md" then validate_index(path)
      when "log.md" then validate_log(path)
      else validate_concept(path)
      end
    end

    validate_required_version
    @errors.empty?
  end

  def report
    @warnings.each { |warning| warn "WARNING #{warning}" }
    @errors.each { |error| warn "ERROR #{error}" }
    return unless @errors.empty?

    profile = @strict ? " (agent-vault strict profile)" : ""
    puts "OKF #{@bundle_version || "undeclared"} conformant#{profile}: " \
         "concepts=#{@concept_count} indexes=#{@index_count} logs=#{@log_count}"
  end

  private

  def markdown_files
    Dir.glob(@root.join("**", "*.md"), File::FNM_DOTMATCH)
       .map { |path| Pathname(path) }
       .select(&:file?)
       .sort
  end

  def relative(path)
    path.relative_path_from(@root).to_s
  end

  def read_utf8(path)
    content = File.read(path, encoding: "UTF-8")
    unless content.valid_encoding?
      @errors << "#{relative(path)}: not valid UTF-8"
      return nil
    end
    content
  rescue ArgumentError, Encoding::InvalidByteSequenceError, Encoding::UndefinedConversionError => error
    @errors << "#{relative(path)}: not valid UTF-8 (#{error.message})"
    nil
  end

  def split_frontmatter(path, required:)
    content = read_utf8(path)
    return [nil, nil] unless content

    unless content.start_with?("---\n") || content.start_with?("---\r\n")
      @errors << "#{relative(path)}: missing leading YAML frontmatter" if required
      return [nil, content]
    end

    lines = content.lines
    closing = lines.each_index.drop(1).find { |index| lines[index].match?(/\A---\s*\r?\n?\z/) }
    unless closing
      @errors << "#{relative(path)}: frontmatter has no closing --- delimiter"
      return [nil, nil]
    end

    yaml = lines[1...closing].join
    body = lines[(closing + 1)..].join
    [parse_yaml(path, yaml), body]
  end

  def parse_yaml(path, yaml)
    value = YAML.safe_load(yaml, permitted_classes: [Date, Time], aliases: false)
    unless value.is_a?(Hash)
      @errors << "#{relative(path)}: frontmatter must be a YAML mapping"
      return nil
    end
    value
  rescue Psych::Exception => error
    @errors << "#{relative(path)}: invalid YAML frontmatter (#{error.message.lines.first.strip})"
    nil
  end

  def validate_concept(path)
    @concept_count += 1
    frontmatter, body = split_frontmatter(path, required: true)
    return unless frontmatter

    type = frontmatter["type"]
    @errors << "#{relative(path)}: type must be a non-empty string" unless nonempty_string?(type)

    validate_v02_families(path, frontmatter, body) if @strict && v02_profile?
  end

  def validate_index(path)
    @index_count += 1
    root_index = path.dirname == @root
    content = read_utf8(path)
    return unless content

    if content.start_with?("---\n") || content.start_with?("---\r\n")
      frontmatter, body = split_frontmatter(path, required: false)
      return unless frontmatter

      unless root_index
        @errors << "#{relative(path)}: only the bundle-root index.md may have frontmatter"
      end
      extra = frontmatter.keys - ["okf_version"]
      @errors << "#{relative(path)}: root index frontmatter may contain only okf_version" unless extra.empty?
      version = frontmatter["okf_version"]
      @errors << "#{relative(path)}: okf_version must be a non-empty string" unless nonempty_string?(version)
      @bundle_version = version.to_s if root_index && nonempty_string?(version)
      validate_index_body(path, body)
    else
      validate_index_body(path, content)
    end
  end

  def validate_index_body(path, body)
    @errors << "#{relative(path)}: index must contain a Markdown heading" unless body.match?(/^#\s+\S/)
    @errors << "#{relative(path)}: index must contain at least one linked list entry" unless body.match?(/^\s*[*+-]\s+\[[^\]]+\]\([^)]+\)/)
  end

  def validate_log(path)
    @log_count += 1
    content = read_utf8(path)
    return unless content

    if content.start_with?("---\n") || content.start_with?("---\r\n")
      @errors << "#{relative(path)}: log.md must not contain frontmatter"
      return
    end

    @errors << "#{relative(path)}: log must start with a level-one heading" unless content.match?(/\A#\s+\S/)
    dates = content.scan(/^##\s+(\d{4}-\d{2}-\d{2})\s*$/).flatten
    @errors << "#{relative(path)}: log must contain ISO 8601 date headings" if dates.empty?
    @errors << "#{relative(path)}: log date headings must be newest first" unless dates == dates.sort.reverse
    @errors << "#{relative(path)}: log must contain list entries" unless content.match?(/^\s*[*+-]\s+\S/)
  end

  def validate_required_version
    return unless @required_version

    if @bundle_version != @required_version
      @errors << "index.md: expected okf_version #{@required_version.inspect}, got #{@bundle_version.inspect}"
    end
  end

  def root_declares_v02?
    root_index = @root.join("index.md")
    return false unless root_index.file?

    content = read_utf8(root_index)
    return false unless content&.start_with?("---")

    yaml = content.split(/^---\s*$/, 3)[1]
    return false unless yaml

    parsed = YAML.safe_load(yaml, permitted_classes: [Date, Time], aliases: false)
    parsed.is_a?(Hash) && parsed["okf_version"].to_s == "0.2"
  rescue Psych::Exception
    false
  end

  def v02_profile?
    @required_version == "0.2" || @bundle_version == "0.2" || root_declares_v02?
  end

  def validate_v02_families(path, frontmatter, body)
    rel = relative(path)

    if frontmatter.key?("status") && !LIFECYCLE_STATUSES.include?(frontmatter["status"])
      @errors << "#{rel}: status must be draft, stable, or deprecated under OKF v0.2"
    end

    validate_date(rel, "stale_after", frontmatter["stale_after"]) if frontmatter.key?("stale_after")
    validate_generated(rel, frontmatter["generated"]) if frontmatter.key?("generated")
    validate_verified(rel, frontmatter["verified"]) if frontmatter.key?("verified")
    validate_sources(rel, frontmatter["sources"], body) if frontmatter.key?("sources")
    validate_usage_window(rel, "usage_window", frontmatter["usage_window"]) if frontmatter.key?("usage_window")
    validate_tags(rel, frontmatter["tags"]) if frontmatter.key?("tags")
    %w[title description resource].each do |field|
      if frontmatter.key?(field) && !nonempty_string?(frontmatter[field])
        @errors << "#{rel}: #{field} must be a non-empty string when present"
      end
    end

    if frontmatter.key?("timestamp")
      @errors << "#{rel}: timestamp is legacy v0.1 metadata; use generated.at"
    end

    validate_attested_computation(rel, frontmatter, body) if frontmatter["type"] == "Attested Computation"
  end

  def validate_generated(rel, generated)
    unless generated.is_a?(Hash)
      @errors << "#{rel}: generated must be a mapping"
      return
    end
    validate_actor(rel, "generated.by", generated["by"])
    validate_datetime(rel, "generated.at", generated["at"]) if generated.key?("at")
  end

  def validate_verified(rel, verified)
    events = verified.is_a?(Array) ? verified : [verified]
    if events.empty?
      @errors << "#{rel}: verified must contain at least one event"
      return
    end
    events.each_with_index do |event, index|
      unless event.is_a?(Hash)
        @errors << "#{rel}: verified[#{index}] must be a mapping"
        next
      end
      validate_actor(rel, "verified[#{index}].by", event["by"])
      validate_datetime(rel, "verified[#{index}].at", event["at"])
    end
  end

  def validate_sources(rel, sources, body)
    unless sources.is_a?(Array) && !sources.empty?
      @errors << "#{rel}: sources must be a non-empty list"
      return
    end

    ids = []
    sources.each_with_index do |source, index|
      unless source.is_a?(Hash)
        @errors << "#{rel}: sources[#{index}] must be a mapping"
        next
      end
      @errors << "#{rel}: sources[#{index}].resource is required" unless nonempty_string?(source["resource"])
      if source.key?("id")
        if nonempty_string?(source["id"])
          ids << source["id"]
        else
          @errors << "#{rel}: sources[#{index}].id must be a non-empty string"
        end
      end
      if source.key?("title") && !nonempty_string?(source["title"])
        @errors << "#{rel}: sources[#{index}].title must be a non-empty string"
      end
      validate_source_author(rel, "sources[#{index}].author", source["author"]) if source.key?("author")
      validate_date(rel, "sources[#{index}].last_modified", source["last_modified"]) if source.key?("last_modified")
      validate_usage_count(rel, "sources[#{index}].usage_count", source["usage_count"]) if source.key?("usage_count")
      if source.key?("usage_window")
        validate_usage_window(rel, "sources[#{index}].usage_window", source["usage_window"])
      end
    end
    @errors << "#{rel}: sources ids must be unique" unless ids.uniq.length == ids.length

    body.to_s.scan(/\[\^([^\]]+)\]/).flatten.uniq.each do |id|
      @errors << "#{rel}: footnote #{id.inspect} has no matching sources[].id" unless ids.include?(id)
    end
  end

  def validate_attested_computation(rel, frontmatter, body)
    @errors << "#{rel}: Attested Computation requires runtime" unless nonempty_string?(frontmatter["runtime"])
    if frontmatter.key?("parameters")
      validate_parameters(rel, frontmatter["parameters"])
    end
    validate_runner(rel, "executor", frontmatter["executor"], receipt: true) if frontmatter.key?("executor")
    validate_runner(rel, "attester", frontmatter["attester"], receipt: false) if frontmatter.key?("attester")

    sections = computation_sections(body)
    fences = sections.map { |section| fenced_code_summary(section) }
    if frontmatter.key?("computation")
      @errors << "#{rel}: computation must be a non-empty path or URI" unless nonempty_string?(frontmatter["computation"])
      if fences.sum { |summary| summary[:openings] }.positive?
        @errors << "#{rel}: Attested Computation with computation path must omit # Computation code"
      end
      return
    end

    valid_inline = sections.length == 1 &&
                   fences.first[:openings] == 1 &&
                   fences.first[:completed] == 1 &&
                   fences.first[:nonempty] == 1
    unless valid_inline
      @errors << "#{rel}: Attested Computation requires exactly one fenced code block under # Computation"
    end
  end

  def computation_sections(body)
    lines = body.to_s.lines
    sections = []
    current = nil
    active_fence = nil

    lines.each do |line|
      if active_fence
        current << line if current
        active_fence = nil if fence_closing?(line, active_fence)
        next
      end

      opening = fence_opening(line)
      if opening
        current << line if current
        active_fence = opening
        next
      end

      if line.match?(/\A#\s+\S/)
        sections << current if current
        current = line.match?(/\A# Computation\s*\r?\n?\z/) ? [] : nil
        next
      end

      current << line if current
    end
    sections << current if current
    sections
  end

  def fenced_code_summary(lines)
    summary = { openings: 0, completed: 0, nonempty: 0 }
    active = nil

    lines.each do |line|
      if active
        if fence_closing?(line, active)
          summary[:completed] += 1
          summary[:nonempty] += 1 if active[:nonempty]
          active = nil
        else
          active[:nonempty] ||= line.match?(/\S/)
        end
        next
      end

      opening = fence_opening(line)
      next unless opening

      summary[:openings] += 1
      active = opening.merge(nonempty: false)
    end

    summary
  end

  def fence_opening(line)
    opening = line.match(/\A {0,3}((?:`{3,})|(?:~{3,}))[^\r\n]*\r?\n?\z/)
    return unless opening

    fence = opening[1]
    { marker: fence[0], length: fence.length }
  end

  def fence_closing?(line, fence)
    line.match?(/\A {0,3}#{Regexp.escape(fence[:marker])}{#{fence[:length]},}\s*\r?\n?\z/)
  end

  def validate_parameters(rel, parameters)
    unless parameters.is_a?(Array)
      @errors << "#{rel}: parameters must be a list"
      return
    end
    parameters.each_with_index do |parameter, index|
      unless parameter.is_a?(Hash)
        @errors << "#{rel}: parameters[#{index}] must be a mapping"
        next
      end
      %w[name type].each do |field|
        @errors << "#{rel}: parameters[#{index}].#{field} is required" unless nonempty_string?(parameter[field])
      end
      unless parameter["required"] == true || parameter["required"] == false
        @errors << "#{rel}: parameters[#{index}].required must be boolean"
      end
    end
  end

  def validate_runner(rel, field, value, receipt:)
    unless value.is_a?(Hash)
      @errors << "#{rel}: #{field} must be a mapping"
      return
    end
    @errors << "#{rel}: #{field}.resource is required" unless nonempty_string?(value["resource"])
    return unless receipt && value.key?("receipt")

    unless nonempty_string_list?(value["receipt"])
      @errors << "#{rel}: executor.receipt must be a list of non-empty strings"
    end
  end

  def validate_usage_window(rel, field, value)
    unless value.is_a?(Hash)
      @errors << "#{rel}: #{field} must be a mapping"
      return
    end
    %w[from to].each do |edge|
      if value.key?(edge)
        validate_date(rel, "#{field}.#{edge}", value[edge])
      else
        @errors << "#{rel}: #{field}.#{edge} is required"
      end
    end
  end

  def validate_usage_count(rel, field, value)
    unless value.is_a?(Numeric) && value >= 0
      @errors << "#{rel}: #{field} must be a non-negative number"
    end
  end

  def validate_tags(rel, value)
    @errors << "#{rel}: tags must be a list of non-empty strings" unless string_list?(value)
  end

  def validate_actor(rel, field, value)
    @errors << "#{rel}: #{field} must follow the OKF actor convention" unless nonempty_string?(value) && ACTOR.match?(value)
  end

  def validate_source_author(rel, field, value)
    valid = nonempty_string?(value) && (ACTOR.match?(value) || value.match?(/\Ateam:[^\s]+\z/))
    @errors << "#{rel}: #{field} must identify an actor or team" unless valid
  end

  def validate_date(rel, field, value)
    text = scalar_time(value, date_only: true)
    @errors << "#{rel}: #{field} must be YYYY-MM-DD" unless text&.match?(ISO_DATE) && valid_date?(text)
  end

  def validate_datetime(rel, field, value)
    text = scalar_time(value, date_only: false)
    Time.iso8601(text)
  rescue ArgumentError, TypeError
    @errors << "#{rel}: #{field} must be an ISO 8601 datetime"
  end

  def scalar_time(value, date_only:)
    return value.strftime(date_only ? "%Y-%m-%d" : "%Y-%m-%dT%H:%M:%S%:z") if value.respond_to?(:strftime)
    value if value.is_a?(String)
  end

  def valid_date?(value)
    Date.iso8601(value)
    true
  rescue Date::Error
    false
  end

  def nonempty_string?(value)
    value.is_a?(String) && !value.strip.empty?
  end

  def string_list?(value)
    value.is_a?(Array) && value.all? { |item| nonempty_string?(item) }
  end

  def nonempty_string_list?(value)
    string_list?(value) && !value.empty?
  end
end

if $PROGRAM_NAME == __FILE__
  options = { required_version: nil, strict: false }
  parser = OptionParser.new do |opts|
    opts.banner = "usage: okf-validate.rb [--require-version VERSION] [--strict] <bundle-path>"
    opts.on("--require-version VERSION", "require a declared root OKF version") do |value|
      options[:required_version] = value
    end
    opts.on("--strict", "enforce the agent-vault v0.2 producer profile") { options[:strict] = true }
  end
  parser.parse!

  root = ARGV.shift
  abort parser.to_s unless root && ARGV.empty?

  validator = OkfValidator.new(root: root, required_version: options[:required_version], strict: options[:strict])
  valid = validator.validate
  validator.report
  exit(valid ? 0 : 1)
end
