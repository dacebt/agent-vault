#!/usr/bin/env ruby
# frozen_string_literal: true

require "date"
require "json"
require "pathname"
require "time"
require "yaml"

def json_value(value)
  case value
  when Date, Time
    value.iso8601
  when Hash
    value.to_h { |key, child| [key.to_s, json_value(child)] }
  when Array
    value.map { |child| json_value(child) }
  when String, Integer, Float, TrueClass, FalseClass, NilClass
    value
  else
    raise "unsupported YAML value #{value.class}"
  end
end

def parse_document(path)
  content = File.read(path, encoding: "UTF-8")
  raise "frontmatter is required" unless content.start_with?("---\n") || content.start_with?("---\r\n")

  lines = content.lines
  closing = lines.each_index.drop(1).find { |index| lines[index].match?(/\A---\s*\r?\n?\z/) }
  raise "frontmatter has no closing delimiter" unless closing

  frontmatter = YAML.safe_load(
    lines[1...closing].join,
    permitted_classes: [Date, Time],
    aliases: false
  )
  raise "frontmatter must be a YAML mapping" unless frontmatter.is_a?(Hash)

  { "frontmatter" => json_value(frontmatter), "body_markdown" => lines[(closing + 1)..].join }
rescue Psych::Exception => error
  raise "invalid YAML frontmatter (#{error.message.lines.first.strip})"
end

root_arg = ARGV.shift
abort "usage: task-markdown-manifest.rb <bundle-path>" unless root_arg && ARGV.empty?

root = Pathname(root_arg).expand_path
abort "#{root}: bundle directory does not exist" unless root.directory?

records = []
errors = []
Dir.glob(root.join("tasks", "**", "*.md")).sort.each do |name|
  path = Pathname(name)
  relative = path.relative_path_from(root).to_s
  next if %w[index.md log.md].include?(path.basename.to_s)

  begin
    records << { "path" => relative }.merge(parse_document(path))
  rescue StandardError => error
    errors << "#{relative}: #{error.message}"
  end
end

puts JSON.generate({ "records" => records, "errors" => errors })
